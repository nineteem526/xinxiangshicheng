import { useCallback, useEffect, useRef, useState } from "react";
import { lensLabel, pickWideLens } from "./lens";
import { parseSignal, RTC_CONFIG, wsUrl, type Caps, type SignalMsg } from "./signal";

type ZoomRange = { min: number; max: number; step: number };

/** Zoom range the browser exposes for this track, or null (most iPhones, many desktops). */
function readZoom(track: MediaStreamTrack): { range: ZoomRange; value: number } | null {
  const c = (track.getCapabilities?.() ?? {}) as { zoom?: Partial<ZoomRange> };
  const z = c.zoom;
  if (!z || typeof z.min !== "number" || typeof z.max !== "number" || z.max <= z.min) return null;
  const value = (track.getSettings() as { zoom?: number }).zoom ?? z.min;
  return { range: { min: z.min, max: z.max, step: z.step ?? 0.1 }, value };
}

type Step = "code" | "starting" | "live" | "error";

/**
 * Phone side. Opens in the phone's browser at https://<pc>:5173/?phone. Asks for the 6-digit code
 * shown on the big screen, then streams the camera to the PC. Nothing else: no game, no AI, no key.
 */
export default function PhoneCam() {
  const [step, setStep] = useState<Step>("code");
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get("code")?.replace(/\D/g, "").slice(0, 6) ?? "");
  const [facing, setFacing] = useState<"user" | "environment">("environment");
  const [msg, setMsg] = useState("");
  const preview = useRef<HTMLVideoElement>(null);
  const ws = useRef<WebSocket | null>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const sender = useRef<RTCRtpSender | null>(null);
  const lenses = useRef<{ id: string; label: string }[]>([]);
  const [zoomUi, setZoomUi] = useState<{ range: ZoomRange; value: number } | null>(null);

  const teardown = useCallback(() => {
    ws.current?.close();
    ws.current = null;
    pc.current?.close();
    pc.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    sender.current = null;
    setZoomUi(null);
  }, []);

  useEffect(() => teardown, [teardown]);

  const fail = (text: string) => {
    teardown();
    setMsg(text);
    setStep("error");
  };

  const connect = async () => {
    if (!/^\d{6}$/.test(code)) return setMsg("请输入大屏上的 6 位数字");
    if (!navigator.mediaDevices?.getUserMedia) return fail("这个浏览器不能打开摄像头。请用 Chrome 或 Safari,并通过 https 地址打开本页。");
    teardown();
    setMsg("");
    setStep("starting");
    try {
      const base = { width: { ideal: 1280 }, height: { ideal: 720 } };
      let media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, ...base }, audio: false });
      // Lens labels are only revealed after permission. Rear + ultra-wide gives the biggest field of view.
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
      if (facing === "environment") {
        const wide = pickWideLens(devs);
        const cur = media.getVideoTracks()[0]?.getSettings().deviceId;
        if (wide && wide !== cur) {
          try {
            const next = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: wide }, ...base }, audio: false });
            media.getTracks().forEach((t) => t.stop());
            media = next;
          } catch {
            /* keep the default lens */
          }
        }
      }
      const rearLenses = devs.filter((d) => !/front|前置|user/i.test(d.label));
      lenses.current = (facing === "environment" ? rearLenses : devs.slice(0, 1)).slice(0, 8).map((d, i) => ({ id: d.deviceId, label: lensLabel(d.label, i) }));
      stream.current = media;
      if (preview.current) {
        preview.current.srcObject = media;
        void preview.current.play().catch(() => undefined);
      }
    } catch (e) {
      const name = (e as DOMException).name;
      return fail(
        name === "NotAllowedError"
          ? "摄像头权限被拒绝。请在浏览器设置里允许本页使用摄像头,然后重试。"
          : name === "NotFoundError"
            ? "没有找到摄像头。"
            : `摄像头启动失败:${(e as Error).message}`,
      );
    }

    const sock = new WebSocket(wsUrl(`/api/link/join?code=${code}`));
    ws.current = sock;
    const send = (m: SignalMsg) => sock.readyState === WebSocket.OPEN && sock.send(JSON.stringify(m));

    const p = new RTCPeerConnection(RTC_CONFIG);
    pc.current = p;
    stream.current?.getTracks().forEach((t) => {
      const s = p.addTrack(t, stream.current!);
      if (t.kind === "video") sender.current = s;
    });

    const track = () => stream.current?.getVideoTracks()[0];
    const caps = (): Caps => {
      const z = track() ? readZoom(track()!) : null;
      return {
        zoom: z?.range ?? null,
        value: z?.value ?? null,
        lenses: lenses.current,
        lensId: track()?.getSettings().deviceId ?? null,
      };
    };
    const announce = () => {
      const c = caps();
      send({ type: "caps", ...c });
      const z = track() ? readZoom(track()!) : null;
      setZoomUi(z);
    };
    /** Start at the widest the phone allows: zoom all the way out. */
    const zoomOut = async () => {
      const z = track() ? readZoom(track()!) : null;
      if (z) await track()!.applyConstraints({ advanced: [{ zoom: z.range.min } as MediaTrackConstraintSet] }).catch(() => undefined);
    };
    const swapLens = async (id: string) => {
      const old = track();
      const next = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: id }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      const nt = next.getVideoTracks()[0];
      await sender.current?.replaceTrack(nt); // no renegotiation: the PC just sees different pixels
      old?.stop();
      stream.current = next;
      if (preview.current) preview.current.srcObject = next;
      await zoomOut();
    };
    p.onicecandidate = (e) => send({ type: "ice", candidate: e.candidate ? e.candidate.toJSON() : null });
    p.onconnectionstatechange = () => {
      if (p.connectionState === "connected") setStep("live");
      if (p.connectionState === "failed") fail("和电脑的连接失败。请确认手机和电脑连的是同一个热点,然后重试。");
    };

    sock.onopen = async () => {
      send({ type: "meta", facing });
      await zoomOut();
      announce();
      try {
        const offer = await p.createOffer();
        await p.setLocalDescription(offer);
        if (offer.sdp) send({ type: "offer", sdp: offer.sdp });
      } catch (e) {
        fail(`建立连接失败:${(e as Error).message}`);
      }
    };
    sock.onmessage = async (ev) => {
      const m = parseSignal(ev.data);
      if (!m) return;
      try {
        if (m.type === "answer") await p.setRemoteDescription({ type: "answer", sdp: m.sdp });
        else if (m.type === "ice" && m.candidate) await p.addIceCandidate(m.candidate);
        else if (m.type === "set") {
          if (m.lens && lenses.current.some((l) => l.id === m.lens)) await swapLens(m.lens);
          if (m.zoom !== undefined && track()) {
            const z = readZoom(track()!);
            if (z) await track()!.applyConstraints({ advanced: [{ zoom: Math.min(z.range.max, Math.max(z.range.min, m.zoom)) } as MediaTrackConstraintSet] });
          }
          announce();
        }
      } catch (e) {
        fail(`建立连接失败:${(e as Error).message}`);
      }
    };
    sock.onclose = (ev) => {
      if (ws.current !== sock) return;
      ws.current = null;
      if (ev.code === 4404) fail("配对码不对,或者已经有另一部手机连上了。请看大屏上的数字再试。");
      else if (ev.code === 4000) fail("电脑已断开。请让电脑重新点“手机直连”。");
      else setStep((s) => (s === "live" ? s : s === "error" ? s : "error"));
    };
  };

  const leave = () => {
    teardown();
    setStep("code");
    setMsg("");
  };

  return (
    <main className="phone">
      <video ref={preview} className="phone-preview" muted playsInline />
      {step !== "live" && step !== "starting" && (
        <section className="phone-sheet">
          <h1>用这部手机当摄像头</h1>
          <p>输入大屏上显示的 6 位数字。画面只传给这台电脑,不会上传到网上。</p>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            aria-label="6 位配对码"
            placeholder="000000"
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
          <div className="phone-seg" role="radiogroup" aria-label="摄像头方向">
            <button role="radio" aria-checked={facing === "environment"} onClick={() => setFacing("environment")}>
              后置摄像头
            </button>
            <button role="radio" aria-checked={facing === "user"} onClick={() => setFacing("user")}>
              前置摄像头
            </button>
          </div>
          {msg && (
            <p className="phone-msg" role="alert">
              {msg}
            </p>
          )}
          <button className="phone-go" onClick={() => void connect()} disabled={code.length !== 6}>
            开始传画面
          </button>
        </section>
      )}
      {step === "starting" && <p className="phone-state">正在连接电脑…</p>}
      {step === "live" && (
        <div className="phone-bar">
          <span>
            <i className="dot on" /> 正在传给电脑
            {zoomUi ? ` · ${zoomUi.value.toFixed(1)}x` : ""}
          </span>
          <button onClick={leave}>停止</button>
        </div>
      )}
    </main>
  );
}

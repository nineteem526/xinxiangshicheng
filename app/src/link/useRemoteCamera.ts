import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { parseSignal, RTC_CONFIG, wsUrl, type Caps, type SignalMsg } from "./signal";

export type LinkStatus = "off" | "connecting" | "waiting" | "paired" | "live" | "error";

export interface LinkInfo {
  ips: string[];
}

/**
 * PC side of "phone as camera". Opens a room, shows its 6-digit code, and when the phone connects,
 * plays the phone's video into the same <video> element the game already analyses. Video travels
 * phone -> PC over WebRTC on the LAN; this server only relays small SDP/ICE messages.
 */
export function useRemoteCamera(videoRef: RefObject<HTMLVideoElement | null>) {
  const [status, setStatus] = useState<LinkStatus>("off");
  const [code, setCode] = useState<string | null>(null);
  const [facing, setFacing] = useState<"user" | "environment" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [caps, setCaps] = useState<Caps | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);

  const closePeer = useCallback(() => {
    pc.current?.close();
    pc.current = null;
    pendingIce.current = [];
  }, []);

  const stop = useCallback(() => {
    ws.current?.close();
    ws.current = null;
    closePeer();
    const v = videoRef.current;
    if (v && v.srcObject) v.srcObject = null;
    setStatus("off");
    setCode(null);
    setFacing(null);
    setCaps(null);
  }, [closePeer, videoRef]);

  /** Ask the phone to change zoom or switch lens. The phone validates and applies it. */
  const command = useCallback((m: { zoom?: number; lens?: string }) => {
    const s = ws.current;
    if (s?.readyState === WebSocket.OPEN) s.send(JSON.stringify({ type: "set", ...m }));
  }, []);

  const start = useCallback(() => {
    stop();
    setError(null);
    setStatus("connecting");
    const sock = new WebSocket(wsUrl("/api/link/host"));
    ws.current = sock;
    const send = (m: SignalMsg) => sock.readyState === WebSocket.OPEN && sock.send(JSON.stringify(m));

    const newPeer = () => {
      closePeer();
      const p = new RTCPeerConnection(RTC_CONFIG);
      pc.current = p;
      p.onicecandidate = (e) => send({ type: "ice", candidate: e.candidate ? e.candidate.toJSON() : null });
      p.ontrack = (e) => {
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = e.streams[0] ?? new MediaStream([e.track]);
        void v.play().catch(() => undefined);
        setStatus("live");
      };
      p.onconnectionstatechange = () => {
        if (p.connectionState === "failed") {
          setError("连接失败。请确认手机和电脑在同一个热点或 Wi-Fi 下,然后让手机重新连接。");
          setStatus("error");
        } else if (p.connectionState === "disconnected") setStatus("paired");
      };
      return p;
    };

    sock.onmessage = async (ev) => {
      const m = parseSignal(ev.data);
      if (!m) return;
      try {
        if (m.type === "room") {
          setCode(m.code);
          setStatus("waiting");
        } else if (m.type === "joined") {
          newPeer();
          setStatus("paired");
        } else if (m.type === "left") {
          closePeer();
          const v = videoRef.current;
          if (v) v.srcObject = null;
          setFacing(null);
          setCaps(null);
          setStatus("waiting");
        } else if (m.type === "meta") {
          setFacing(m.facing);
        } else if (m.type === "caps") {
          setCaps({ zoom: m.zoom, value: m.value, lenses: m.lenses, lensId: m.lensId });
        } else if (m.type === "offer") {
          const p = pc.current ?? newPeer();
          await p.setRemoteDescription({ type: "offer", sdp: m.sdp });
          for (const c of pendingIce.current.splice(0)) await p.addIceCandidate(c);
          const answer = await p.createAnswer();
          await p.setLocalDescription(answer);
          if (answer.sdp) send({ type: "answer", sdp: answer.sdp });
        } else if (m.type === "ice" && m.candidate) {
          const p = pc.current;
          if (p?.remoteDescription) await p.addIceCandidate(m.candidate);
          else pendingIce.current.push(m.candidate);
        }
      } catch (e) {
        setError(`手机连接出错:${(e as Error).message}`);
        setStatus("error");
      }
    };
    sock.onerror = () => {
      setError("无法连接后端。请先运行 server/start.bat。");
      setStatus("error");
    };
    sock.onclose = () => {
      if (ws.current === sock) {
        ws.current = null;
        setStatus((s) => (s === "error" ? s : "off"));
      }
    };
  }, [closePeer, stop, videoRef]);

  useEffect(() => stop, [stop]);

  return { status, code, facing, caps, error, start, stop, command };
}

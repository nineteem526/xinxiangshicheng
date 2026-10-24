import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { createInitialState, keyboardTarget, reducer } from "./game/engine";
import { captureFrame, requestLevel, requestScene, type LevelResult } from "./game/api";
import { rectUnderHand } from "./game/rifts";
import { RiftLayer } from "./ui/RiftLayer";
import { PRESET_LEVELS } from "./game/levels";
import { playSfx, setMuted, unlockAudio } from "./game/sfx";
import { GESTURE_ACTION, GESTURE_LABEL, GESTURES, type EventType, type GestureName, type Level } from "./game/types";
import { useCamera } from "./vision/useCamera";
import { TRAIT_HINT, TRAIT_LABEL } from "./game/traits";
import { Creep } from "./ui/Creep";
import { LensBar } from "./link/LensBar";
import { PairPanel } from "./link/PairPanel";
import type { Fit } from "./game/rifts";
import { useRemoteCamera } from "./link/useRemoteCamera";
import { grabGray, type Gray } from "./vision/tracker";
import { useRiftTracking } from "./vision/useRiftTracking";
import { useGestures, type HandPos } from "./vision/useGestures";

const KEYMAP: Record<string, GestureName> = { "1": "Open_Palm", "2": "Closed_Fist", "3": "Victory" };

const EVENT_TEXT: Partial<Record<EventType, string>> = {
  fist: "攻击命中",
  block: "格挡成功",
  shield: "护盾展开",
  wave: "入侵波来袭,张开手掌防御",
  hit: "防线被击穿",
  special: "封印冲击",
  special_fail: "技能能量不足",
  rift_sealed: "入侵点已封印!现实碎裂",
  miss: "把手移到物品上方再攻击",
  shield_hit: "护盾出现裂痕",
  shield_break: "护盾碎了,现在可以攻击",
  charge_burst: "蓄力爆发!",
  phase_open: "窗口打开,快打",
  locked: "打不到:先看它的打法",
  combo_hit: "连击",
  combo_break: "连击中断,它在恢复",
};

// What the recogniser sees, in Chinese. Only the first three do anything in the game.
const GESTURE_NAME_ZH: Record<string, string> = {
  Open_Palm: "张开手掌",
  Closed_Fist: "握拳",
  Victory: "V 手势",
  None: "未识别手势",
  Thumb_Up: "点赞(无效)",
  Thumb_Down: "拇指向下(无效)",
  Pointing_Up: "食指向上(无效)",
  ILoveYou: "我爱你(无效)",
};

const WEAK_HINT: Record<GestureName, string> = {
  Open_Palm: "格挡能量翻倍",
  Closed_Fist: "攻击伤害翻倍",
  Victory: "封印伤害 ×1.5",
};

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, () => createInitialState());
  const [levelIdx, setLevelIdx] = useState(0);
  const [sound, setSound] = useState(true);
  const [flash, setFlash] = useState<{ id: number; type: EventType } | null>(null);
  const [toast, setToast] = useState<string>("");
  const [lastSource, setLastSource] = useState<"camera" | "manual" | null>(null);
  const [showDebug, setShowDebug] = useState(true);
  const [custom, setCustom] = useState<Level | null>(null);
  const [gen, setGen] = useState<{ busy: boolean; msg: string }>({ busy: false, msg: "" });
  const [objName, setObjName] = useState("");
  // 3-2-1 before the clock starts, so the player can get a hand up. UI-only; the engine is untouched.
  const [count, setCount] = useState<number | null>(null);
  const busyRef = useRef(false);
  const [seed, setSeed] = useState<Gray | null>(null);
  // Front/webcam is shown mirrored (like a mirror). Phone rear camera must NOT be mirrored.
  // Fit: "auto" shows the whole frame for a portrait phone feed, crops to fill for a landscape one.
  const [fitMode, setFitMode] = useState<"auto" | Fit>("auto");
  const [mirrorMode, setMirrorMode] = useState<"auto" | "on" | "off">("auto");
  // 0 = strictest … 4 = most sensitive. Maps to the stabilizer confidence threshold.
  const [sensLevel, setSensLevel] = useState(2);
  const sens = [0.75, 0.68, 0.6, 0.5, 0.4][sensLevel];
  const sensLabel = ["最严格", "较严格", "标准", "较灵敏", "最灵敏"][sensLevel];
  const current = custom ?? PRESET_LEVELS[levelIdx];
  const currentRef = useRef(current);
  currentRef.current = current;

  const cam = useCamera();
  const link = useRemoteCamera(cam.videoRef);
  const [showPair, setShowPair] = useState(false);
  const linkLive = link.status === "live";
  const camOn = cam.status === "ready" || linkLive;
  const overlayRef = useRef<HTMLCanvasElement>(null);

  const phaseRef = useRef(state.phase);
  phaseRef.current = state.phase;

  const riftsRef = useRef(state.rifts);
  riftsRef.current = state.rifts;
  const [target, setTarget] = useState<number | undefined>(undefined);
  const tracking = useRef<{ rects: React.RefObject<import("./game/rifts").NRect[]>; lost: React.RefObject<boolean[]> } | null>(null);
  const liveRects = () => tracking.current?.rects.current ?? [];

  const onGesture = useCallback((g: GestureName, src: "camera" | "manual", hand: HandPos = null) => {
    setLastSource(src);
    const live = riftsRef.current;
    let riftIndex: number | undefined;
    if (live.length) {
      // Camera: the rift under the hand. Keyboard/buttons: the first unsealed rift (demo fallback).
      if (src === "camera") {
        // Only live rifts are targets; the tracked rect is where the object is now.
        const rs = liveRects();
        const alive = rs.map((r, i) => (live[i]?.hp > 0 ? r : { x: -9, y: -9, w: 0, h: 0 }));
        riftIndex = rectUnderHand(alive, hand);
      } else {
        riftIndex = keyboardTarget(live, g);
      }
    }
    dispatch({ type: "GESTURE", gesture: g, riftIndex });
  }, []);

  const gestures = useGestures(cam.videoRef, overlayRef, camOn, (g, hand) => onGesture(g, "camera", hand), sens);
  const trk = useRiftTracking(cam.videoRef, gestures.handRef, state.level.rifts, seed, camOn && state.phase !== "idle");
  tracking.current = { rects: trk.rects, lost: trk.lost };

  // Throttled "which rift is under the hand" for the HUD highlight.
  useEffect(() => {
    if (state.phase !== "playing" || !state.rifts.length) {
      setTarget(undefined);
      return;
    }
    const id = setInterval(() => {
      const alive = liveRects().map((r, i) => (riftsRef.current[i]?.hp > 0 ? r : { x: -9, y: -9, w: 0, h: 0 }));
      setTarget(rectUnderHand(alive, gestures.handRef.current));
    }, 80);
    return () => clearInterval(id);
  }, [state.phase, state.rifts.length, gestures.handRef]);

  // Game clock
  useEffect(() => {
    if (state.phase !== "playing") return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      dispatch({ type: "TICK", dt: Math.min(now - last, 250) });
      last = now;
    }, 50);
    return () => clearInterval(id);
  }, [state.phase]);

  // React to engine events: sound + visual flash + toast
  useEffect(() => {
    const ev = state.event;
    if (!ev) return;
    playSfx(ev.type);
    setFlash(ev);
    const text = EVENT_TEXT[ev.type];
    if (text) setToast(text);
    const t = setTimeout(() => setFlash(null), 450);
    return () => clearTimeout(t);
  }, [state.event]);

  useEffect(() => setMuted(!sound), [sound]);

  const countRef = useRef<number | null>(null);
  countRef.current = count;
  const start = useCallback(() => {
    if (busyRef.current || countRef.current !== null) return; // scanning, or already counting down
    unlockAudio();
    setCount(3);
  }, []);

  useEffect(() => {
    if (count === null) return;
    if (count === 0) {
      setCount(null);
      dispatch({ type: "START", level: currentRef.current });
      return;
    }
    const t = setTimeout(() => setCount(count - 1), 800);
    return () => clearTimeout(t);
  }, [count]);

  const reset = useCallback(() => dispatch({ type: "RESET", level: currentRef.current }), []);

  const pickPreset = (i: number) => {
    setLevelIdx(i);
    setCustom(null);
    setSeed(null);
    setGen({ busy: false, msg: "" });
    dispatch({ type: "RESET", level: PRESET_LEVELS[i] });
  };

  // Generate a level from a camera frame or a typed item name. On any failure keep the current preset.
  const generate = async (mode: "scene" | "scan" | "manual") => {
    if (gen.busy || count !== null) return;
    let req: Promise<LevelResult>;
    if (mode === "scene" || mode === "scan") {
      const video = cam.videoRef.current;
      const img = video && camOn ? captureFrame(video, 800) : null;
      const frozen = video && camOn ? grabGray(video) : null; // same instant as the image sent to the model
      if (!img) return setGen({ busy: false, msg: "请先开启摄像头并等待画面出现" });
      setSeed(frozen);
      req = mode === "scene" ? requestScene(img) : requestLevel({ image: img });
    } else {
      const name = objName.trim();
      if (!name) return setGen({ busy: false, msg: "请输入物品名称" });
      req = requestLevel({ object: name });
    }
    const busyMsg = { scene: "正在扫描桌面,定位每件物品并生成入侵事件…", scan: "正在扫描物品并生成关卡…", manual: "正在生成关卡…" }[mode];
    busyRef.current = true;
    setGen({ busy: true, msg: busyMsg });
    const res = await req;
    busyRef.current = false;
    if (phaseRef.current !== "idle") return;
    if (res.ok) {
      setCustom(res.level);
      dispatch({ type: "RESET", level: res.level });
      const rifts = res.level.rifts;
      setGen({
        busy: false,
        msg: rifts ? `已定位 ${rifts.length} 个入侵点:${rifts.map((r) => `${r.object}→${r.fantasyName}`).join(" · ")}` : `已生成:${res.level.object} → ${res.level.fantasyName}`,
      });
    } else {
      setGen({ busy: false, msg: `生成失败(${res.error}),已使用预设关卡:${PRESET_LEVELS[levelIdx].object}` });
      setCustom(null);
      setSeed(null);
      dispatch({ type: "RESET", level: PRESET_LEVELS[levelIdx] });
    }
  };

  // Keyboard fallback (1/2/3 = gestures, Space/Enter = start, R = reset)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "SELECT" || tag === "INPUT") return;
      if (KEYMAP[e.key]) onGesture(KEYMAP[e.key], "manual");
      else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (phaseRef.current === "playing") return;
        if (phaseRef.current === "idle") start();
        else reset();
      } else if (e.key.toLowerCase() === "r") {
        setCount(null);
        reset();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onGesture, start, reset]);

  const lv = state.level;
  const secs = Math.ceil(state.timeLeft / 1000);
  const urgent = state.phase === "playing" && secs <= 10;
  // How deep the corruption has crept in: from stability loss, and from the last seconds of the clock.
  const danger =
    state.phase === "playing"
      ? Math.min(1, (100 - state.stability) / 100 + (urgent ? 0.25 : 0) + (state.wave ? 0.12 : 0))
      : state.phase === "failure"
        ? 1
        : 0;
  const wavePct = state.wave ? (state.wave.remaining / state.wave.window) * 100 : 0;
  const activeLabel = cam.devices.find((d) => d.deviceId === cam.deviceId)?.label ?? "";
  // Rear/phone cameras (Iriun, "back", "environment") show the real world: never mirror them.
  const looksRear = linkLive ? link.facing !== "user" : /iriun|back|rear|environment|后置|droidcam|obs/i.test(activeLabel);
  const mirrored = mirrorMode === "auto" ? !looksRear : mirrorMode === "on";
  const vEl = cam.videoRef.current;
  const portraitFeed = !!vEl && vEl.videoHeight > vEl.videoWidth;
  const fit: Fit = fitMode === "auto" ? (portraitFeed ? "contain" : "cover") : fitMode;

  const togglePair = () => {
    if (showPair || link.status !== "off") {
      link.stop();
      setShowPair(false);
      return;
    }
    cam.stop(); // the <video> can show only one source
    link.start();
    setShowPair(true);
  };

  return (
    <div className={`app ${mirrored ? "" : "no-mirror"} fit-${fit} ${flash ? `fx-${flash.type}` : ""}`} style={{ ["--accent" as string]: lv.accent }}>
      <video ref={cam.videoRef} className="bg-video" muted playsInline />
      <canvas ref={overlayRef} className="bg-overlay" />
      {!camOn && <div className="bg-fallback" />}
      {state.rifts.length > 0 && (
        <RiftLayer
          videoRef={cam.videoRef}
          rifts={state.rifts}
          rectsRef={trk.rects}
          lostRef={trk.lost}
          mirrored={mirrored}
          fit={fit}
          handRef={gestures.handRef}
          holdRef={gestures.holdRef}
          targetIndex={target}
          event={state.event}
          active={camOn && state.phase !== "idle"}
        />
      )}
      <div className="vignette" />
      <Creep danger={danger} playing={state.phase === "playing"} />

      {/* Top bar */}
      <header className="topbar">
        <div className="brand">
          RealityGlitch
          <small>现实入侵</small>
        </div>
        <div className="controls">
          <select
            value={cam.deviceId}
            onChange={(e) => {
              cam.setDeviceId(e.target.value);
              void cam.start(e.target.value);
            }}
            disabled={!cam.devices.length}
            aria-label="选择摄像头"
          >
            {cam.devices.length === 0 && <option>未检测到摄像头</option>}
            {cam.devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              if (link.status !== "off") {
                link.stop();
                setShowPair(false);
              }
              if (cam.status === "ready") cam.stop();
              else void cam.start();
            }}
            disabled={cam.status === "starting"}
          >
            {cam.status === "starting" ? "连接中…" : cam.status === "ready" ? "关闭摄像头" : "开启摄像头"}
          </button>
          <button onClick={togglePair} className={showPair || link.status !== "off" ? "on" : ""}>
            手机直连
          </button>
          <button
            onClick={() => setMirrorMode((m) => (m === "auto" ? (mirrored ? "off" : "on") : m === "on" ? "off" : "on"))}
            title="前置摄像头建议镜像,后置/手机摄像头不要镜像"
          >
            画面{mirrored ? "镜像" : "正常"}
            {mirrorMode === "auto" ? "·自动" : ""}
          </button>
          <button onClick={() => setFitMode((m) => (m === "auto" ? (fit === "cover" ? "contain" : "cover") : m === "cover" ? "contain" : "cover"))} title="填满:裁掉边缘铺满屏幕。完整:显示手机拍到的全部画面">
            {fit === "cover" ? "画面填满" : "画面完整"}
            {fitMode === "auto" ? "·自动" : ""}
          </button>
          <button onClick={() => setSound((s) => !s)} aria-pressed={sound}>
            {sound ? "音效开" : "音效关"}
          </button>
          <button onClick={() => setShowDebug((s) => !s)} aria-pressed={showDebug}>
            识别面板
          </button>
        </div>
      </header>

      {/* Status strip */}
      <div className="mode-strip" role="status">
        <span className={`dot ${camOn ? "on" : "off"}`} />
        {linkLive ? "手机直连在线" : camOn ? "摄像头在线" : "摄像头未开启,可用键盘 1 2 3 演示"}
        <span className="sep">|</span>
        手势模型{gestures.model === "ready" ? "就绪,本地运行" : gestures.model === "loading" ? "加载中" : "加载失败"}
        <span className="sep">|</span>
        关卡来源:{lv.source === "preset" ? "预设数据(离线)" : lv.source === "ai" ? "AI 生成" : "手动输入"}
        {state.rifts.length > 0 && (
          <>
            <span className="sep">|</span>
            {state.rifts.length} 个入侵点锚定在真实物品上
          </>
        )}
      </div>

      {showPair && (
        <PairPanel
          status={link.status}
          code={link.code}
          facing={link.facing}
          error={link.error}
          onClose={() => {
            link.stop();
            setShowPair(false);
          }}
        />
      )}

      {linkLive && link.caps && (
        <LensBar caps={link.caps} onZoom={(z) => link.command({ zoom: z })} onLens={(id) => link.command({ lens: id })} />
      )}

      {(cam.error || gestures.modelError) && (
        <div className="alert" role="alert">
          {cam.error ?? gestures.modelError}
        </div>
      )}

      {/* Center: timer + wave */}
      {state.phase !== "idle" && (
        <div className="center-top">
          <div className={`timer ${urgent ? "urgent" : ""}`}>{String(secs).padStart(2, "0")}</div>
          <div className="time-rule">
            <i style={{ width: `${Math.max(0, Math.min(100, (state.timeLeft / (lv.duration * 1000)) * 100))}%` }} />
          </div>
          <div className="mission">{lv.mission}</div>
        </div>
      )}

      {state.phase === "playing" && state.wave && (
        <div className="wave-warning" role="alert">
          <div className="wave-title">入侵波来袭,张开手掌防御</div>
          <div className="wave-bar">
            <i style={{ width: `${wavePct}%` }} />
          </div>
        </div>
      )}

      {state.phase === "playing" && state.shieldMs > 0 && <div className="shield-ring" />}

      {toast && state.phase === "playing" && (
        <div key={state.event?.id} className="toast">
          {toast}
        </div>
      )}

      {/* Left meters */}
      {state.phase !== "idle" && (
        <aside className="meters">
          <Meter label="现实稳定度" value={state.stability} tone={state.stability < 35 ? "danger" : "ok"} />
          <Meter label={state.rifts.length ? "入侵总强度" : "异常体强度"} value={state.hp} tone="enemy" />
          {state.rifts.length > 0 && (
            <ul className="rift-list">
              {state.rifts.map((r, i) => (
                <li key={r.object} className={r.hp <= 0 ? "sealed" : target === i ? "hot" : ""}>
                  <span>
                    {r.fantasyName}
                    {r.trait !== "plain" && r.hp > 0 && <small className="trait">{TRAIT_LABEL[r.trait]}</small>}
                  </span>
                  <i style={{ width: `${r.hp}%` }} />
                  <em>{r.hp > 0 && r.trait !== "plain" ? TRAIT_HINT[r.trait] : GESTURE_LABEL[r.weakness]}</em>
                </li>
              ))}
            </ul>
          )}
          <Meter label={state.energy >= 100 ? "技能就绪,做 V 手势" : "技能能量"} value={state.energy} tone={state.energy >= 100 ? "ready" : "energy"} />
          <div className="object-tag">
            <b>{lv.fantasyName}</b>
            <span>{lv.object}</span>
            <span>弱点 {GESTURE_LABEL[lv.weakness]},{WEAK_HINT[lv.weakness]}</span>
          </div>
        </aside>
      )}

      {/* Right: gesture panel */}
      {showDebug && (
        <aside className="gesture-panel">
          <div className="gp-title">手势识别</div>
          <div className="gp-now">
            {camOn ? (gestures.live.hand ? GESTURE_NAME_ZH[gestures.live.name] ?? "其他手势" : "未检测到手") : "摄像头关闭"}
            {camOn && gestures.live.hand && <em>{(gestures.live.score * 100) | 0}%</em>}
          </div>
          <div className="gp-bar">
            <i style={{ width: `${gestures.live.progress * 100}%` }} />
          </div>
          <div className="gp-meta">
            {camOn ? `${gestures.fps} fps,推理 ${gestures.live.inferMs.toFixed(0)}ms` : "—"}
            {lastSource && <div>最近输入:{lastSource === "camera" ? "摄像头手势" : "键盘/按钮"}</div>}
          </div>
          <label className="gp-sens">
            识别灵敏度:{sensLabel}
            <input
              type="range"
              min={0}
              max={4}
              step={1}
              value={sensLevel}
              aria-label="识别灵敏度"
              onChange={(e) => setSensLevel(Number(e.target.value))}
            />
          </label>
          <ul className="gp-list">
            {GESTURES.map((g) => (
              <li key={g} className={camOn && gestures.live.name === g && gestures.live.hand ? "hit" : ""}>
                <span>{GESTURE_LABEL[g]}</span>
                <b>{GESTURE_ACTION[g]}</b>
                <button onClick={() => onGesture(g, "manual")} disabled={state.phase !== "playing"}>
                  {Object.keys(KEYMAP).find((k) => KEYMAP[k] === g)}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}

      {/* Overlays */}
      {count !== null && count > 0 && (
        <div className="countdown" role="status" aria-live="assertive">
          <b key={count}>{count}</b>
          <span>举起手,准备封印</span>
        </div>
      )}

      {state.phase === "idle" && count === null && (
        <div className="panel intro">
          <h1>
            现实正在被入侵<small>60 秒封印战</small>
          </h1>
          <p className="story">{lv.story}</p>
          <div className="rules">
            <div>
              <b>张开手掌</b>
              <span>防御入侵波,积累能量</span>
            </div>
            <div>
              <b>握拳</b>
              <span>手放在物品上,攻击它</span>
            </div>
            <div>
              <b>V 手势</b>
              <span>能量满时释放封印</span>
            </div>
          </div>
          <p className="goal weak">
            {lv.fantasyName}的弱点是<b>{GESTURE_LABEL[lv.weakness]}</b>,{WEAK_HINT[lv.weakness]}。限时 {lv.duration} 秒,难度 {lv.difficulty}/3。
          </p>
          <p className="goal">
            {lv.rifts?.length
              ? "把手移到真实物品上方做手势,逐个封印入侵点。全部封印即胜利。"
              : "在现实稳定度归零或倒计时结束前,把异常体强度打到 0。"}
          </p>
          <div className="level-pick">
            <label>
              预设关卡
              <select value={levelIdx} onChange={(e) => pickPreset(Number(e.target.value))}>
                {PRESET_LEVELS.map((l, i) => (
                  <option key={l.object} value={i}>
                    {l.object} → {l.fantasyName}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="scan-box">
            <button className="scene-btn" onClick={() => void generate("scene")} disabled={gen.busy || !camOn}>
              扫描桌面,把物品变成入侵点
            </button>
            <button onClick={() => void generate("scan")} disabled={gen.busy || !camOn}>
              单件扫描
            </button>
            <input
              value={objName}
              maxLength={12}
              placeholder="或输入物品名,如水杯"
              aria-label="手动输入物品名"
              onChange={(e) => setObjName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void generate("manual")}
            />
            <button onClick={() => void generate("manual")} disabled={gen.busy}>
              生成关卡
            </button>
          </div>
          {gen.busy && <div className="progress" aria-hidden><i /></div>}
          {gen.msg && (
            <p className={`hint ${gen.msg.startsWith("生成失败") ? "bad" : ""}`} role="status">
              {gen.msg}
            </p>
          )}
          <button className="primary" onClick={start} autoFocus disabled={gen.busy}>
            开始入侵
          </button>
          <p className="hint">{camOn ? "按空格开始。" : "先点右上角“开启摄像头”。不开也能用键盘 1 2 3 玩,空格开始。"}</p>
        </div>
      )}

      {(state.phase === "success" || state.phase === "failure") && (
        <div className={`panel result ${state.phase}`}>
          <h1>{state.phase === "success" ? "封印成功" : "现实已被入侵"}</h1>
          <p className="story">{state.phase === "success" ? lv.lines.success : lv.lines.failure}</p>
          <div className="stats">
            <div><b>{state.stats.blocked}</b><span>成功格挡</span></div>
            <div><b>{state.stats.hits}</b><span>被击中</span></div>
            <div><b>{state.stats.actions}</b><span>总动作</span></div>
            <div><b>{Math.round(state.stability)}%</b><span>剩余稳定度</span></div>
          </div>
          <button className="primary" onClick={() => { reset(); start(); }} autoFocus>
            同一关再来一局
          </button>
          <button className="ghost" onClick={reset}>
            回到开始界面,换物品重新扫描
          </button>
        </div>
      )}
    </div>
  );
}

function Meter({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`meter ${tone}`}>
      <div className="meter-head">
        <span>{label}</span>
        <b>{Math.round(value)}%</b>
      </div>
      <div className="meter-bar" role="progressbar" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

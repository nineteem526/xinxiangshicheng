import { useEffect, useRef, useState, type RefObject } from "react";
import { DrawingUtils, FilesetResolver, GestureRecognizer } from "@mediapipe/tasks-vision";
import { GestureStabilizer } from "./stabilizer";
import type { GestureName } from "../game/types";

export type ModelStatus = "loading" | "ready" | "error";

export interface LiveGesture {
  name: string; // raw MediaPipe label, or "None"
  score: number;
  hand: boolean;
  progress: number; // 0..1 toward trigger
  inferMs: number;
}

/** Which gesture is being held and how close it is to firing (0..1). */
export type HoldState = { progress: number; gesture: GestureName | null };

/** Hand centre in normalized video coords (0..1, un-mirrored). Null when no hand. */
export type HandPos = { x: number; y: number } | null;

const BASE = import.meta.env.BASE_URL;

/**
 * Runs MediaPipe on the live <video>. Everything stays on-device; model + wasm are served locally.
 * `onTrigger` fires only after the stabilizer confirms a held gesture.
 */
export function useGestures(
  videoRef: RefObject<HTMLVideoElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  active: boolean,
  onTrigger: (g: GestureName, hand: HandPos) => void,
  minScore = 0.6,
) {
  const [model, setModel] = useState<ModelStatus>("loading");
  const [modelError, setModelError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveGesture>({ name: "None", score: 0, hand: false, progress: 0, inferMs: 0 });
  const [fps, setFps] = useState(0);

  const recognizer = useRef<GestureRecognizer | null>(null);
  const stabilizer = useRef(new GestureStabilizer());
  const trigger = useRef(onTrigger);
  trigger.current = onTrigger;
  /** Latest hand centre, updated every frame without re-rendering. */
  const handRef = useRef<HandPos>(null);
  /** Hold progress 0..1 and the gesture being held, updated every frame for the on-canvas ring. */
  const holdRef = useRef<HoldState>({ progress: 0, gesture: null });
  useEffect(() => stabilizer.current.setMinScore(minScore), [minScore]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fileset = await FilesetResolver.forVisionTasks(`${BASE}wasm`);
        const make = (delegate: "GPU" | "CPU") =>
          GestureRecognizer.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: `${BASE}models/gesture_recognizer.task`, delegate },
            runningMode: "VIDEO",
            numHands: 1,
            // Looser than the 0.5 default: a rear camera sees a smaller, back-of-hand view.
            minHandDetectionConfidence: 0.35,
            minHandPresenceConfidence: 0.35,
            minTrackingConfidence: 0.35,
          });
        let r: GestureRecognizer;
        try {
          r = await make("GPU");
        } catch {
          r = await make("CPU");
        }
        if (cancelled) return r.close();
        recognizer.current = r;
        setModel("ready");
      } catch (e) {
        if (cancelled) return;
        setModel("error");
        setModelError(`手势模型加载失败:${(e as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
      recognizer.current?.close();
      recognizer.current = null;
    };
  }, []);

  useEffect(() => {
    if (!active || model !== "ready") return;
    let raf = 0;
    let frames = 0;
    let fpsT = performance.now();
    let lastVideoTime = -1;
    let lastTs = 0;
    let lastUi = 0;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const v = videoRef.current;
      const c = canvasRef.current;
      const r = recognizer.current;
      if (!v || !c || !r || v.readyState < 2 || !v.videoWidth) return;
      if (v.currentTime === lastVideoTime) return; // no new frame yet
      lastVideoTime = v.currentTime;

      if (c.width !== v.videoWidth) {
        c.width = v.videoWidth;
        c.height = v.videoHeight;
      }
      const now = performance.now();
      const ts = Math.max(now, lastTs + 1); // MediaPipe needs strictly increasing timestamps
      lastTs = ts;
      const t0 = performance.now();
      const res = r.recognizeForVideo(v, ts);
      const inferMs = performance.now() - t0;

      const ctx = c.getContext("2d")!;
      ctx.clearRect(0, 0, c.width, c.height);
      let name = "None";
      let score = 0;
      const hand = !!res.landmarks?.length;
      if (hand) {
        const lm = res.landmarks[0];
        // Palm centre: mean of wrist (0) and the four finger MCP joints (5, 9, 13, 17).
        const pts = [lm[0], lm[5], lm[9], lm[13], lm[17]];
        handRef.current = { x: pts.reduce((a, q) => a + q.x, 0) / 5, y: pts.reduce((a, q) => a + q.y, 0) / 5 };
        const du = new DrawingUtils(ctx);
        du.drawConnectors(lm, GestureRecognizer.HAND_CONNECTIONS, { color: "#00f0ff", lineWidth: 3 });
        du.drawLandmarks(lm, { color: "#ff2bd6", radius: 3 });
        const g = res.gestures?.[0]?.[0];
        if (g) {
          name = g.categoryName;
          score = g.score;
        }
      }

      if (!hand) handRef.current = null;
      const fired = stabilizer.current.update(hand ? name : null, score, now);
      holdRef.current = { progress: stabilizer.current.progress(now), gesture: stabilizer.current.candidate() };
      if (fired) trigger.current(fired, handRef.current);

      frames++;
      if (now - fpsT >= 1000) {
        setFps(frames);
        frames = 0;
        fpsT = now;
      }
      if (now - lastUi > 50) {
        lastUi = now;
        setLive({ name, score, hand, progress: stabilizer.current.progress(now), inferMs });
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      stabilizer.current.reset();
    };
  }, [active, model, videoRef, canvasRef]);

  return { model, modelError, live, fps, handRef, holdRef };
}

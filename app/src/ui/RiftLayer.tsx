import { useEffect, useRef, type RefObject } from "react";
import type { NRect } from "../game/rifts";
import { toScreen, type Fit } from "../game/rifts";
import { drawShatter, makeShatter, type Shatter } from "../game/shatter";
import type { GameEvent, RiftState } from "../game/types";
import { GESTURE_LABEL } from "../game/types";
import type { HandPos, HoldState } from "../vision/useGestures";

// Red = the intrusion (default for every live rift). Yellow = the player's focus. Blue = system / restored.
// All three are pulled down in brightness so the footage stays readable.
const YELLOW = "#d9c60c";
const BLUE = "#1f9fb8";
const RED = "#c4122f";
const RED_HI = "#e0193a";
const INK = "#ece8da";
const BLACK = "#0a0a0c";
const FONT = '"Bahnschrift", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  rifts: RiftState[];
  /** Live tracked rects (normalized, un-mirrored), one per rift. Updated by the tracker without re-rendering. */
  rectsRef: RefObject<NRect[]>;
  lostRef: RefObject<boolean[]>;
  mirrored: boolean;
  fit: Fit;
  handRef: RefObject<HandPos>;
  holdRef: RefObject<HoldState>;
  targetIndex: number | undefined; // rift currently under the hand (from parent, throttled)
  event: GameEvent | null;
  active: boolean;
}

/**
 * Corrupt the live pixels of the real object: horizontal slice tearing, a red wash, a few
 * blocky "data" fragments and one scan bar. Red because it is the intrusion; strength follows hp.
 */
function drawGlitch(ctx: CanvasRenderingContext2D, v: HTMLVideoElement, sr: NRect, nr: NRect, mirrored: boolean, t: number, power: number) {
  const slices = 8;
  const vw = v.videoWidth;
  const vh = v.videoHeight;
  const sh = (nr.h * vh) / slices;
  const dh = sr.h / slices;
  const tick = Math.floor(t / 90);
  const rnd = (k: number) => {
    const n = Math.sin(tick * 12.9898 + k * 78.233) * 43758.5453;
    return n - Math.floor(n);
  };
  ctx.save();
  ctx.beginPath();
  ctx.rect(sr.x, sr.y, sr.w, sr.h);
  ctx.clip();
  for (let i = 0; i < slices; i++) {
    const f = rnd(i);
    const jitter = f > 0.55 ? (f - 0.775) * sr.w * 0.5 * power : 0;
    const sx = nr.x * vw;
    const sy = nr.y * vh + i * sh;
    const dy = sr.y + i * dh;
    if (mirrored) {
      ctx.save();
      ctx.translate(sr.x + sr.w + jitter, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(v, sx, sy, nr.w * vw, sh, 0, 0, sr.w, dh + 1);
      ctx.restore();
    } else {
      ctx.drawImage(v, sx, sy, nr.w * vw, sh, sr.x + jitter, dy, sr.w, dh + 1);
    }
  }
  // Red wash, heavier on the slices that tore.
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = `rgba(196, 18, 47, ${0.45 * power})`;
  ctx.fillRect(sr.x, sr.y, sr.w, sr.h);
  ctx.globalCompositeOperation = "source-over";
  // Data fragments: small solid blocks that flicker in and out.
  for (let k = 0; k < 6; k++) {
    if (rnd(20 + k) < 0.45) continue;
    const bw = (0.06 + rnd(30 + k) * 0.16) * sr.w;
    const bh = 3 + rnd(40 + k) * 7;
    ctx.fillStyle = rnd(50 + k) > 0.7 ? `rgba(217, 198, 12, ${0.7 * power})` : `rgba(224, 25, 58, ${0.8 * power})`;
    ctx.fillRect(sr.x + rnd(60 + k) * (sr.w - bw), sr.y + rnd(70 + k) * (sr.h - bh), bw, bh);
  }
  ctx.fillStyle = `rgba(236, 232, 218, ${0.4 * power})`;
  ctx.fillRect(sr.x, sr.y + ((tick * 37) % Math.max(1, Math.round(sr.h))), sr.w, 1.5);
  ctx.restore();
}

function corners(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, L: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + L);
  ctx.lineTo(x, y);
  ctx.lineTo(x + L, y);
  ctx.moveTo(x + w - L, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + L);
  ctx.moveTo(x + w, y + h - L);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w - L, y + h);
  ctx.moveTo(x + L, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + h - L);
  ctx.stroke();
}

/**
 * Viewfinder overlay on top of the live video: corner brackets glued to the real objects, a hairline
 * for each object's remaining strength, the player's hand with a recognition-progress ring, and the
 * reality-shatter effect. Pure presentation; no game rules here.
 */
export function RiftLayer({ videoRef, rifts, rectsRef, lostRef, mirrored, fit, handRef, holdRef, targetIndex, event, active }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shatters = useRef<Shatter[]>([]);
  const lastEvent = useRef<number>(0);
  const targetRef = useRef(targetIndex);
  targetRef.current = targetIndex;
  const riftsRef = useRef(rifts);
  riftsRef.current = rifts;

  // Spawn a shatter when a rift takes damage.
  useEffect(() => {
    if (!event || event.id === lastEvent.current) return;
    lastEvent.current = event.id;
    if (event.riftIndex === undefined || !["fist", "special", "rift_sealed"].includes(event.type)) return;
    const v = videoRef.current;
    const c = canvasRef.current;
    const r = riftsRef.current[event.riftIndex];
    if (!v || !c || !r) return;
    const nr = rectsRef.current?.[event.riftIndex];
    if (!nr) return;
    const sr = toScreen(nr, v.videoWidth, v.videoHeight, c.clientWidth, c.clientHeight, mirrored, fit);
    const strength = event.type === "rift_sealed" ? 2 : event.type === "special" ? 1.6 : 1;
    const s = makeShatter(v, sr, nr, RED_HI, performance.now(), strength, mirrored);
    if (s) shatters.current.push(s);
  }, [event, videoRef, rectsRef, mirrored, fit]);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const c = canvasRef.current;
      const v = videoRef.current;
      if (!c || !v) return;
      const W = c.clientWidth;
      const H = c.clientHeight;
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, W, H);

      riftsRef.current.forEach((r, i) => {
        const nr = rectsRef.current?.[i];
        if (!nr) return;
        const sr = toScreen(nr, v.videoWidth, v.videoHeight, W, H, mirrored, fit);
        const lost = !!lostRef.current?.[i];
        const sealed = r.hp <= 0;
        const hot = targetRef.current === i && !sealed;
        if (!sealed && !lost) drawGlitch(ctx, v, sr, nr, mirrored, now, 0.35 + 0.65 * (r.hp / 100));

        const e = hot ? 6 : 0;
        const x = sr.x - e;
        const y = sr.y - e;
        const w = sr.w + e * 2;
        const h = sr.h + e * 2;
        const L = Math.max(14, Math.min(w, h) * 0.22);

        ctx.save();
        ctx.lineCap = "butt";
        ctx.lineWidth = hot ? 3 : 2;
        const frame = sealed ? BLUE : hot ? YELLOW : RED;
        ctx.strokeStyle = frame;
        corners(ctx, x, y, w, h, L);

        // Scanner tag in the 2077 style: a yellow cut-corner plate stuck to the object.
        const nameSize = 15;
        const title = sealed ? `${r.fantasyName} // 已封印` : r.fantasyName;
        ctx.font = `700 ${nameSize}px ${FONT}`;
        const tw = Math.ceil(ctx.measureText(title).width) + 22;
        const th = 26;
        const above = y - th - 8 > 4;
        const tx = Math.max(4, Math.min(W - tw - 4, x));
        const ty = above ? y - th - 8 : y + h + 8;
        ctx.fillStyle = sealed ? BLUE : hot ? YELLOW : lost ? "#6b0f1e" : RED;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx + tw, ty);
        ctx.lineTo(tx + tw, ty + th - 8);
        ctx.lineTo(tx + tw - 8, ty + th);
        ctx.lineTo(tx, ty + th);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = hot ? BLACK : INK;
        ctx.textAlign = "left";
        ctx.fillText(title, tx + 11, ty + 18);

        if (!sealed) {
          // Segmented strength bar (10 cells), the way 2077 draws health.
          const cells = 10;
          const gap = 3;
          const bw = Math.max(80, Math.min(w, 220));
          const cw = (bw - gap * (cells - 1)) / cells;
          const by = above ? ty - 12 : ty + th + 8;
          const on = Math.ceil((r.hp / 100) * cells);
          for (let k = 0; k < cells; k++) {
            ctx.fillStyle = k < on ? (r.hp < 35 ? YELLOW : RED_HI) : "rgba(236,232,218,.2)";
            ctx.fillRect(tx + k * (cw + gap), by, cw, 5);
          }
          ctx.font = `600 12px ${FONT}`;
          ctx.fillStyle = lost ? RED_HI : INK;
          ctx.shadowColor = "rgba(0,0,0,.9)";
          ctx.shadowBlur = 6;
          const info = lost ? `${r.object}  信号丢失,等待重新锁定` : `${r.object}  弱点 ${GESTURE_LABEL[r.weakness]}`;
          ctx.fillText(info, tx, above ? by - 8 : by + 20);
        }
        ctx.restore();
      });

      // Hand: ring + recognition progress. This is the "it is reading you" feedback.
      const hnd = handRef.current;
      if (hnd) {
        const p = toScreen({ x: hnd.x, y: hnd.y, w: 0, h: 0 }, v.videoWidth, v.videoHeight, W, H, mirrored, fit);
        const hold = holdRef.current;
        const onTarget = targetRef.current !== undefined;
        ctx.save();
        const col = onTarget ? YELLOW : BLUE;
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        // Crosshair: four ticks around a gap, plus a diamond.
        const g = 9;
        const t = 22;
        ctx.beginPath();
        ctx.moveTo(p.x - t, p.y); ctx.lineTo(p.x - g, p.y);
        ctx.moveTo(p.x + g, p.y); ctx.lineTo(p.x + t, p.y);
        ctx.moveTo(p.x, p.y - t); ctx.lineTo(p.x, p.y - g);
        ctx.moveTo(p.x, p.y + g); ctx.lineTo(p.x, p.y + t);
        ctx.stroke();
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 3); ctx.lineTo(p.x + 3, p.y); ctx.lineTo(p.x, p.y + 3); ctx.lineTo(p.x - 3, p.y);
        ctx.closePath();
        ctx.fill();
        if (hold && hold.gesture && hold.progress > 0) {
          // Charge ring, drawn as 12 segments that fill in.
          const segs = 12;
          const lit = Math.ceil(Math.min(1, hold.progress) * segs);
          ctx.lineWidth = 4;
          ctx.strokeStyle = YELLOW;
          for (let k = 0; k < lit; k++) {
            const a0 = -Math.PI / 2 + (k / segs) * Math.PI * 2 + 0.06;
            const a1 = -Math.PI / 2 + ((k + 1) / segs) * Math.PI * 2 - 0.06;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 32, a0, a1);
            ctx.stroke();
          }
          ctx.font = `700 14px ${FONT}`;
          const label = GESTURE_LABEL[hold.gesture];
          const lw = ctx.measureText(label).width + 16;
          ctx.fillStyle = YELLOW;
          ctx.fillRect(p.x + 42, p.y - 11, lw, 22);
          ctx.fillStyle = BLACK;
          ctx.fillText(label, p.x + 50, p.y + 5);
        }
        ctx.restore();
      }

      shatters.current = shatters.current.filter((s) => drawShatter(ctx, s, now, dt));
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      shatters.current = [];
    };
  }, [active, videoRef, handRef, holdRef, rectsRef, lostRef, mirrored, fit]);

  return <canvas ref={canvasRef} className="rift-layer" aria-hidden />;
}

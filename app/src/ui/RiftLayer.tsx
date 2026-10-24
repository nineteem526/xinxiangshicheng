import { useEffect, useRef, type RefObject } from "react";
import type { NRect } from "../game/rifts";
import { toScreen, type Fit } from "../game/rifts";
import { drawShatter, makeShatter, type Shatter } from "../game/shatter";
import { isOpen } from "../game/engine";
import { BARRIER_HP, CHARGE_PER_HIT, COMBO_NEED, COMBO_WINDOW_MS, PHASE_OPEN_MS, PHASE_PERIOD_MS, TRAIT_HINT, TRAIT_LABEL } from "../game/traits";
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

/** Hexagon path centred on (cx, cy). */
function hex(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k - Math.PI / 6;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/**
 * The per-object marker. It is drawn ON the real item and encodes the rule at a glance:
 *   barrier  a blue hexagon shield that cracks as it takes palm hits
 *   charge   a ring around the object that fills as strikes stack, and drains when you stop
 *   phase    the frame goes solid and bright while it can be hit, dashed and dim while it is locked
 *   combo    pips along the bottom that light per hit, with a timer sliver that shrinks
 * Returns true when the object is currently untouchable (so the tag can say so).
 */
function drawTrait(ctx: CanvasRenderingContext2D, r: RiftState, x: number, y: number, w: number, h: number, now: number): boolean {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rad = Math.max(w, h) * 0.58;
  ctx.save();
  if (r.trait === "barrier" && r.barrier > 0) {
    const left = r.barrier / BARRIER_HP;
    hex(ctx, cx, cy, rad);
    ctx.fillStyle = `rgba(31, 159, 184, ${0.1 + 0.16 * left})`;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = BLUE;
    ctx.stroke();
    // Cracks: more of them the less shield is left.
    const cracks = Math.round((1 - left) * 4);
    ctx.lineWidth = 2;
    ctx.strokeStyle = INK;
    for (let k = 0; k < cracks; k++) {
      const a = k * 1.7 + 0.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * rad * 0.15, cy + Math.sin(a) * rad * 0.15);
      ctx.lineTo(cx + Math.cos(a + 0.2) * rad * 0.55, cy + Math.sin(a + 0.2) * rad * 0.55);
      ctx.lineTo(cx + Math.cos(a - 0.15) * rad * 0.95, cy + Math.sin(a - 0.15) * rad * 0.95);
      ctx.stroke();
    }
  } else if (r.trait === "charge") {
    const f = Math.min(1, r.charge / 100);
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(236, 232, 218, 0.18)";
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.stroke();
    if (f > 0) {
      ctx.strokeStyle = f >= 1 - CHARGE_PER_HIT / 100 ? YELLOW : RED_HI;
      ctx.lineCap = "butt";
      ctx.beginPath();
      ctx.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f);
      ctx.stroke();
    }
  } else if (r.trait === "phase") {
    const open = isOpen(r);
    if (open) {
      // How much of the window is left: a bar under the box.
      const left = 1 - r.phaseAt / PHASE_OPEN_MS;
      ctx.fillStyle = YELLOW;
      ctx.fillRect(x, y + h + 3, w * Math.max(0, left), 4);
      ctx.strokeStyle = YELLOW;
      ctx.lineWidth = 4;
      ctx.strokeRect(x - 5, y - 5, w + 10, h + 10);
    } else {
      // Locked: how long until it opens again.
      const toOpen = PHASE_PERIOD_MS - r.phaseAt;
      ctx.fillStyle = "rgba(236, 232, 218, 0.28)";
      ctx.fillRect(x, y + h + 3, w * Math.min(1, 1 - toOpen / (PHASE_PERIOD_MS - PHASE_OPEN_MS)), 4);
      ctx.strokeStyle = "rgba(236, 232, 218, 0.5)";
      ctx.setLineDash([8, 8]);
      ctx.lineDashOffset = -now / 40;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 5, y - 5, w + 10, h + 10);
      ctx.setLineDash([]);
    }
  } else if (r.trait === "combo") {
    const pip = 14;
    const gap = 6;
    const total = COMBO_NEED * pip + (COMBO_NEED - 1) * gap;
    const px = cx - total / 2;
    for (let k = 0; k < COMBO_NEED; k++) {
      ctx.fillStyle = k < r.chain ? YELLOW : "rgba(236, 232, 218, 0.22)";
      ctx.fillRect(px + k * (pip + gap), y + h + 8, pip, 8);
    }
    if (r.chain > 0) {
      ctx.fillStyle = RED_HI;
      ctx.fillRect(px, y + h + 19, total * Math.max(0, r.chainMs / COMBO_WINDOW_MS), 3);
    }
  }
  ctx.restore();
  return (r.trait === "barrier" && r.barrier > 0) || (r.trait === "phase" && !isOpen(r));
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
    if (event.riftIndex === undefined || !["fist", "special", "rift_sealed", "charge_burst", "combo_hit"].includes(event.type)) return;
    const v = videoRef.current;
    const c = canvasRef.current;
    const r = riftsRef.current[event.riftIndex];
    if (!v || !c || !r) return;
    const nr = rectsRef.current?.[event.riftIndex];
    if (!nr) return;
    const sr = toScreen(nr, v.videoWidth, v.videoHeight, c.clientWidth, c.clientHeight, mirrored, fit);
    const strength = event.type === "rift_sealed" ? 2 : event.type === "charge_burst" ? 1.8 : event.type === "special" ? 1.6 : 1;
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
        const locked = !sealed && !lost ? drawTrait(ctx, r, x, y, w, h, now) : false;

        // Scanner tag in the 2077 style: a cut-corner plate stuck to the object.
        const nameSize = 15;
        const traitTag = !sealed && r.trait !== "plain" ? `[${TRAIT_LABEL[r.trait]}] ` : "";
        const title = sealed ? `${r.fantasyName} // 已封印` : `${traitTag}${r.fantasyName}`;
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
          const rule = r.trait === "plain" ? "" : locked ? "  锁定中" : "";
          const info = lost
            ? `${r.object}  信号丢失,等待重新锁定`
            : `${r.object}  弱点 ${GESTURE_LABEL[r.weakness]}${rule}  ${r.trait === "plain" ? "" : TRAIT_HINT[r.trait]}`;
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

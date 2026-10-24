import type { NRect } from "../game/rifts";

/** Grayscale frame, row-major. */
export interface Gray {
  data: Uint8Array;
  w: number;
  h: number;
}

/** Tracking runs on a small frame; this width keeps a 4-object search well under a millisecond budget. */
export const TRACK_W = 192;

/** Below this similarity (0..1) a match is rejected and the object is marked lost. */
export const ACCEPT = 0.55;

export function rgbaToGray(rgba: Uint8ClampedArray, w: number, h: number): Gray {
  const out = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return { data: out, w, h };
}

export function cropGray(g: Gray, x: number, y: number, w: number, h: number): Gray {
  const out = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) out.set(g.data.subarray((y + r) * g.w + x, (y + r) * g.w + x + w), r * w);
  return { data: out, w, h };
}

function meanOf(g: Gray, w: number, h: number, ox: number, oy: number, step: number): number {
  let s = 0;
  let n = 0;
  for (let y = 0; y < h; y += step) {
    const row = (oy + y) * g.w + ox;
    for (let x = 0; x < w; x += step) {
      s += g.data[row + x];
      n++;
    }
  }
  return s / n;
}

/** Zero-mean SAD: invariant to a uniform brightness shift (auto-exposure). Early-exits past `bound`. */
function sad(frame: Gray, tpl: Gray, tMean: number, fMean: number, ox: number, oy: number, step: number, bound: number): number {
  const d = tMean - fMean;
  let s = 0;
  for (let y = 0; y < tpl.h; y += step) {
    const rf = (oy + y) * frame.w + ox;
    const rt = y * tpl.w;
    for (let x = 0; x < tpl.w; x += step) {
      const v = frame.data[rf + x] - tpl.data[rt + x] + d;
      s += v < 0 ? -v : v;
    }
    if (s > bound) return Infinity;
  }
  return s;
}

export interface Match {
  x: number; // top-left, px
  y: number;
  score: number; // 0..1
}

function stats(tpl: Gray, step: number) {
  const tMean = meanOf(tpl, tpl.w, tpl.h, 0, 0, step);
  let dev = 0;
  let n = 0;
  for (let y = 0; y < tpl.h; y += step)
    for (let x = 0; x < tpl.w; x += step) {
      dev += Math.abs(tpl.data[y * tpl.w + x] - tMean);
      n++;
    }
  return { tMean, mad: dev / n, n };
}

/**
 * Find `tpl` in `frame` near (cx, cy) within ±radius. Coarse pass at step 2, then a ±2 px refine at step 1.
 * Score is 1 - meanAbsDiff / (2 * templateContrast): ~1 for the same patch, ~0 for an unrelated one.
 */
export function findBest(frame: Gray, tpl: Gray, cx: number, cy: number, radius: number): Match {
  const minX = Math.max(0, cx - radius);
  const maxX = Math.min(frame.w - tpl.w, cx + radius);
  const minY = Math.max(0, cy - radius);
  const maxY = Math.min(frame.h - tpl.h, cy + radius);
  if (maxX < minX || maxY < minY) return { x: cx, y: cy, score: 0 };

  const c = stats(tpl, 2);
  let best = Infinity;
  let bx = Math.min(Math.max(cx, minX), maxX);
  let by = Math.min(Math.max(cy, minY), maxY);
  for (let oy = minY; oy <= maxY; oy += 2) {
    for (let ox = minX; ox <= maxX; ox += 2) {
      const s = sad(frame, tpl, c.tMean, meanOf(frame, tpl.w, tpl.h, ox, oy, 2), ox, oy, 2, best);
      if (s < best) {
        best = s;
        bx = ox;
        by = oy;
      }
    }
  }

  const f = stats(tpl, 1);
  if (f.mad < 3) return { x: bx, y: by, score: 0 }; // flat patch: nothing to lock on to
  let fine = Infinity;
  let fx = bx;
  let fy = by;
  for (let oy = Math.max(0, by - 2); oy <= Math.min(frame.h - tpl.h, by + 2); oy++) {
    for (let ox = Math.max(0, bx - 2); ox <= Math.min(frame.w - tpl.w, bx + 2); ox++) {
      const s = sad(frame, tpl, f.tMean, meanOf(frame, tpl.w, tpl.h, ox, oy, 1), ox, oy, 1, fine);
      if (s < fine) {
        fine = s;
        fx = ox;
        fy = oy;
      }
    }
  }
  const score = Math.max(0, 1 - fine / f.n / (2 * f.mad));
  return { x: fx, y: fy, score };
}

interface Item {
  tpl: Gray;
  x: number;
  y: number;
  locked: boolean;
  lost: boolean;
  /** Consecutive failed matches. After a few, search the whole frame again. */
  miss: number;
  age: number;
}

/** After this many failed updates (~0.5 s at 12 Hz) an object is searched for across the whole frame. */
const WIDEN_AFTER = 6;

/**
 * Keeps each rift glued to its real object. Templates are cut from the frame that was scanned,
 * so even if the camera moved while the model was thinking, the first update searches the whole
 * frame and re-finds them. Occluded or unmatched objects keep their last position and report `lost`.
 */
export class RiftTracker {
  private items: Item[];
  private w: number;
  private h: number;

  constructor(seed: Gray, boxes: NRect[]) {
    this.w = seed.w;
    this.h = seed.h;
    this.items = boxes.map((b) => {
      const w = Math.min(seed.w, Math.max(10, Math.round(b.w * seed.w)));
      const h = Math.min(seed.h, Math.max(10, Math.round(b.h * seed.h)));
      const x = Math.min(seed.w - w, Math.max(0, Math.round(b.x * seed.w)));
      const y = Math.min(seed.h - h, Math.max(0, Math.round(b.y * seed.h)));
      return { tpl: cropGray(seed, x, y, w, h), x, y, locked: false, lost: false, miss: 0, age: 0 };
    });
  }

  /** blocked[i] = the player's hand is over object i: keep its last position instead of matching. */
  update(frame: Gray, blocked: boolean[] = []): void {
    if (frame.w !== this.w || frame.h !== this.h) return;
    this.items.forEach((it, i) => {
      if (blocked[i]) return; // hand is over it: a partial match would drift, so hold the last position
      const near = it.locked && it.miss < WIDEN_AFTER;
      const radius = near ? Math.round(this.w * 0.2) : Math.max(this.w, this.h);
      const m = findBest(frame, it.tpl, it.x, it.y, radius);
      if (m.score >= ACCEPT) {
        it.x = m.x;
        it.y = m.y;
        it.locked = true;
        it.lost = false;
        it.miss = 0;
        // Slowly refresh the template so gradual light/scale change does not break the lock.
        if (m.score > 0.88 && ++it.age % 6 === 0) it.tpl = cropGray(frame, m.x, m.y, it.tpl.w, it.tpl.h);
      } else {
        it.lost = true;
        it.miss++;
      }
    });
  }

  rects(): NRect[] {
    return this.items.map((it) => ({ x: it.x / this.w, y: it.y / this.h, w: it.tpl.w / this.w, h: it.tpl.h / this.h }));
  }

  lost(): boolean[] {
    return this.items.map((it) => it.lost);
  }
}

let scratch: HTMLCanvasElement | null = null;

/** Downscale the live video into a grayscale frame. Null until the video has a real frame. */
export function grabGray(video: HTMLVideoElement): Gray | null {
  if (!video.videoWidth || !video.videoHeight || video.readyState < 2) return null;
  const h = Math.round((TRACK_W * video.videoHeight) / video.videoWidth);
  scratch ??= document.createElement("canvas");
  if (scratch.width !== TRACK_W || scratch.height !== h) {
    scratch.width = TRACK_W;
    scratch.height = h;
  }
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, TRACK_W, h);
  return rgbaToGray(ctx.getImageData(0, 0, TRACK_W, h).data, TRACK_W, h);
}

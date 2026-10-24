import type { Rift } from "./types";

/** Normalized rect in 0..1 video coords (un-mirrored): x, y, w, h. */
export interface NRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Convert a model box [ymin,xmin,ymax,xmax] in 0..1000 into a normalized rect. */
export function riftRect(r: Rift): NRect {
  const [ymin, xmin, ymax, xmax] = r.box;
  return { x: xmin / 1000, y: ymin / 1000, w: (xmax - xmin) / 1000, h: (ymax - ymin) / 1000 };
}

/**
 * Which rect is under the hand? Rects are padded by `pad` (fraction of the frame) so the
 * player does not need pixel-accurate placement. Nearest centre wins when rects overlap.
 */
export function rectUnderHand(rects: NRect[], hand: { x: number; y: number } | null, pad = 0.06): number | undefined {
  if (!hand) return undefined;
  let best: number | undefined;
  let bestD = Infinity;
  rects.forEach((b, i) => {
    if (hand.x < b.x - pad || hand.x > b.x + b.w + pad || hand.y < b.y - pad || hand.y > b.y + b.h + pad) return;
    const d = (hand.x - (b.x + b.w / 2)) ** 2 + (hand.y - (b.y + b.h / 2)) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** Rift under the hand using the model's original boxes (no tracking). */
export function riftUnderHand(rifts: Rift[], hand: { x: number; y: number } | null, pad = 0.06): number | undefined {
  return rectUnderHand(rifts.map(riftRect), hand, pad);
}

/** Is the hand over this rect (for "occluded, hold position")? */
export function handOver(b: NRect, hand: { x: number; y: number } | null, pad = 0.05): boolean {
  return !!hand && hand.x >= b.x - pad && hand.x <= b.x + b.w + pad && hand.y >= b.y - pad && hand.y <= b.y + b.h + pad;
}

/** How the video fills its element: crop to fill the screen, or show the whole frame. */
export type Fit = "cover" | "contain";

const fitScale = (fit: Fit, videoW: number, videoH: number, elW: number, elH: number) =>
  fit === "contain" ? Math.min(elW / videoW, elH / videoH) : Math.max(elW / videoW, elH / videoH);

/**
 * Map a normalized video rect onto the on-screen element (object-fit + mirrored).
 * Returns CSS pixel rect relative to the element's box.
 */
export function toScreen(b: NRect, videoW: number, videoH: number, elW: number, elH: number, mirrored = true, fit: Fit = "cover"): NRect {
  if (!videoW || !videoH) return { x: 0, y: 0, w: 0, h: 0 };
  const scale = fitScale(fit, videoW, videoH, elW, elH);
  const dw = videoW * scale;
  const dh = videoH * scale;
  const ox = (elW - dw) / 2;
  const oy = (elH - dh) / 2;
  const x = mirrored ? ox + (1 - b.x - b.w) * dw : ox + b.x * dw;
  return { x, y: oy + b.y * dh, w: b.w * dw, h: b.h * dh };
}

/** Inverse of toScreen: an on-screen rect back to a normalized (un-mirrored) video rect. */
export function toVideo(r: NRect, videoW: number, videoH: number, elW: number, elH: number, mirrored = true, fit: Fit = "cover"): NRect {
  if (!videoW || !videoH) return { x: 0, y: 0, w: 0, h: 0 };
  const scale = fitScale(fit, videoW, videoH, elW, elH);
  const dw = videoW * scale;
  const dh = videoH * scale;
  const ox = (elW - dw) / 2;
  const oy = (elH - dh) / 2;
  const w = r.w / dw;
  const nx = (r.x - ox) / dw;
  return { x: mirrored ? 1 - nx - w : nx, y: (r.y - oy) / dh, w, h: r.h / dh };
}

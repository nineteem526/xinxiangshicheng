import { describe, expect, it } from "vitest";
import { RiftTracker, type Gray } from "./tracker";

const W = 192;
const H = 108;

const lattice = (i: number, j: number) => {
  const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return n - Math.floor(n);
};
/** Smooth value noise (bilinear, 6 px cells), like real image texture rather than per-pixel static. */
const vnoise = (x: number, y: number) => {
  const gx = x / 6;
  const gy = y / 6;
  const i = Math.floor(gx);
  const j = Math.floor(gy);
  const fx = gx - i;
  const fy = gy - j;
  const a = lattice(i, j) * (1 - fx) + lattice(i + 1, j) * fx;
  const b = lattice(i, j + 1) * (1 - fx) + lattice(i + 1, j + 1) * fx;
  return a * (1 - fy) + b * fy;
};

/** Deterministic textured scene; (dx,dy) is an exact translation of the content. */
function scene(dx = 0, dy = 0, bright = 0): Gray {
  const data = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x - dx;
      const v = y - dy;
      const val = 40 + 170 * vnoise(u, v) + 25 * vnoise(u * 2.3 + 50, v * 2.3 + 50) + bright;
      data[y * W + x] = Math.max(0, Math.min(255, val));
    }
  }
  return { data, w: W, h: H };
}

// An object at px (60,30), 40x30, as a normalized box.
const box = { x: 60 / W, y: 30 / H, w: 40 / W, h: 30 / H };
const px = (t: RiftTracker) => {
  const r = t.rects()[0];
  return { x: Math.round(r.x * W), y: Math.round(r.y * H) };
};

describe("RiftTracker", () => {
  it("stays put when nothing moved", () => {
    const t = new RiftTracker(scene(), [box]);
    t.update(scene());
    expect(px(t)).toEqual({ x: 60, y: 30 });
    expect(t.lost()).toEqual([false]);
  });

  it("follows the object when the camera pans", () => {
    const t = new RiftTracker(scene(), [box]);
    t.update(scene());
    t.update(scene(12, -7));
    expect(px(t)).toEqual({ x: 72, y: 23 });
    t.update(scene(25, -3));
    expect(px(t)).toEqual({ x: 85, y: 27 });
    expect(t.lost()).toEqual([false]);
  });

  it("re-finds the object across the whole frame on the first update (camera moved during the scan)", () => {
    const t = new RiftTracker(scene(), [box]);
    t.update(scene(55, 20));
    expect(px(t)).toEqual({ x: 115, y: 50 });
  });

  it("survives a brightness change (auto exposure)", () => {
    const t = new RiftTracker(scene(), [box]);
    t.update(scene(8, 4, 25));
    expect(px(t)).toEqual({ x: 68, y: 34 });
    expect(t.lost()).toEqual([false]);
  });

  it("holds position and reports lost when the object is covered", () => {
    const t = new RiftTracker(scene(), [box]);
    t.update(scene(10, 0));
    const covered = scene(10, 0);
    for (let y = 25; y < 70; y++) for (let x = 65; x < 120; x++) covered.data[y * W + x] = 200;
    t.update(covered);
    expect(t.lost()).toEqual([true]);
    expect(px(t)).toEqual({ x: 70, y: 30 });
    t.update(scene(10, 0)); // uncovered again → recovered
    expect(t.lost()).toEqual([false]);
  });

  it("after a long occlusion it searches the whole frame and recovers an object that moved far", () => {
    const t = new RiftTracker(scene(), [box]);
    t.update(scene(10, 0));
    const covered = scene(10, 0);
    for (let y = 25; y < 70; y++) for (let x = 65; x < 120; x++) covered.data[y * W + x] = 200;
    for (let i = 0; i < 8; i++) t.update(covered);
    expect(t.lost()).toEqual([true]);
    t.update(scene(60, 20)); // far beyond the normal search radius
    expect(t.lost()).toEqual([false]);
    expect(px(t)).toEqual({ x: 120, y: 50 });
  });

  it("tracks several objects independently", () => {
    const b2 = { x: 130 / W, y: 60 / H, w: 36 / W, h: 30 / H };
    const t = new RiftTracker(scene(), [box, b2]);
    t.update(scene(-9, 6));
    const [r1, r2] = t.rects();
    expect([Math.round(r1.x * W), Math.round(r1.y * H)]).toEqual([51, 36]);
    expect([Math.round(r2.x * W), Math.round(r2.y * H)]).toEqual([121, 66]);
  });

  it("ignores a frame of a different size", () => {
    const t = new RiftTracker(scene(), [box]);
    t.update({ data: new Uint8Array(10 * 10), w: 10, h: 10 });
    expect(px(t)).toEqual({ x: 60, y: 30 });
  });
});

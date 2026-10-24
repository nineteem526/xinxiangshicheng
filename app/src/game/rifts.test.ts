import { describe, expect, it } from "vitest";
import { handOver, riftRect, riftUnderHand, toScreen, toVideo } from "./rifts";
import type { Rift } from "./types";

const r = (box: [number, number, number, number], object = "x"): Rift => ({ object, fantasyName: object, weakness: "Closed_Fist", box });

describe("rifts geometry", () => {
  it("converts model boxes to normalized rects", () => {
    expect(riftRect(r([100, 200, 400, 600]))).toEqual({ x: 0.2, y: 0.1, w: 0.4, h: 0.3 });
  });

  it("finds the rift under the hand, with padding, nearest centre on overlap", () => {
    const rifts = [r([100, 100, 400, 400], "a"), r([300, 300, 700, 700], "b")];
    expect(riftUnderHand(rifts, null)).toBeUndefined();
    expect(riftUnderHand(rifts, { x: 0.2, y: 0.2 })).toBe(0);
    expect(riftUnderHand(rifts, { x: 0.6, y: 0.6 })).toBe(1);
    expect(riftUnderHand(rifts, { x: 0.35, y: 0.35 })).toBe(0); // overlap → nearer centre (0.25,0.25)
    expect(riftUnderHand(rifts, { x: 0.9, y: 0.1 })).toBeUndefined();
    expect(riftUnderHand(rifts, { x: 0.05, y: 0.2 })).toBe(0); // inside padding
    expect(riftUnderHand(rifts, { x: 0.02, y: 0.2 })).toBeUndefined(); // outside padding
  });

  it("maps to screen with object-fit cover and mirroring", () => {
    // 640x480 video on a 1280x720 element: scale = 2 (width-bound); drawn 1280x960, oy = -120
    const b = { x: 0.25, y: 0.5, w: 0.25, h: 0.25 };
    expect(toScreen(b, 640, 480, 1280, 720, false)).toEqual({ x: 320, y: 360, w: 320, h: 240 });
    const m = toScreen(b, 640, 480, 1280, 720, true);
    expect(m.x).toBe(640); // (1 - 0.25 - 0.25) * 1280
    expect(toScreen(b, 0, 0, 1, 1)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it("toVideo inverts toScreen in both mirror modes", () => {
    const b = { x: 0.3, y: 0.4, w: 0.2, h: 0.25 };
    for (const mirrored of [true, false]) {
      const back = toVideo(toScreen(b, 640, 480, 1280, 720, mirrored), 640, 480, 1280, 720, mirrored);
      expect(back.x).toBeCloseTo(b.x, 9);
      expect(back.y).toBeCloseTo(b.y, 9);
      expect(back.w).toBeCloseTo(b.w, 9);
      expect(back.h).toBeCloseTo(b.h, 9);
    }
  });

  it("contain mode letterboxes instead of cropping, and toVideo still inverts it", () => {
    // 360x640 portrait video in a 1280x720 element: height-bound, scale = 1.125, drawn 405x720, ox = 437.5
    const full = { x: 0, y: 0, w: 1, h: 1 };
    const r = toScreen(full, 360, 640, 1280, 720, false, "contain");
    expect(r).toEqual({ x: 437.5, y: 0, w: 405, h: 720 });
    // cover would crop: width-bound scale 3.556 -> 1280x2275 drawn
    expect(toScreen(full, 360, 640, 1280, 720, false, "cover").h).toBeCloseTo(2275.55, 1);
    const b = { x: 0.2, y: 0.3, w: 0.4, h: 0.2 };
    for (const mirrored of [true, false]) {
      const back = toVideo(toScreen(b, 360, 640, 1280, 720, mirrored, "contain"), 360, 640, 1280, 720, mirrored, "contain");
      expect(back.x).toBeCloseTo(b.x, 9);
      expect(back.y).toBeCloseTo(b.y, 9);
    }
  });

  it("handOver respects padding", () => {
    const b = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };
    expect(handOver(b, { x: 0.5, y: 0.5 })).toBe(true);
    expect(handOver(b, { x: 0.37, y: 0.5 })).toBe(true);
    expect(handOver(b, { x: 0.2, y: 0.5 })).toBe(false);
    expect(handOver(b, null)).toBe(false);
  });
});

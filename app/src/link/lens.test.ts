import { describe, expect, it } from "vitest";
import { lensLabel, pickWideLens, zoomPresets } from "./lens";

describe("pickWideLens", () => {
  it("prefers the ultra-wide rear lens", () => {
    const list = [
      { deviceId: "a", label: "camera2 1, facing front" },
      { deviceId: "b", label: "camera2 0, facing back" },
      { deviceId: "c", label: "camera2 2, facing back, ultra wide" },
    ];
    expect(pickWideLens(list)).toBe("c");
    expect(pickWideLens([{ deviceId: "x", label: "Back Ultra Wide Camera" }])).toBe("x");
    expect(pickWideLens([{ deviceId: "y", label: "后置超广角摄像头" }])).toBe("y");
  });

  it("returns null when lenses cannot be told apart or labels are hidden", () => {
    expect(pickWideLens([{ deviceId: "b", label: "camera2 0, facing back" }])).toBeNull();
    expect(pickWideLens([{ deviceId: "b", label: "" }])).toBeNull();
    expect(pickWideLens([])).toBeNull();
  });

  it("never picks the front camera", () => {
    expect(pickWideLens([{ deviceId: "f", label: "front ultra wide" }])).toBeNull();
  });
});

describe("lensLabel / zoomPresets", () => {
  it("names lenses", () => {
    expect(lensLabel("Back Ultra Wide Camera", 2)).toBe("超广角");
    expect(lensLabel("camera2 0, facing back", 0)).toBe("主摄");
    expect(lensLabel("weird", 3)).toBe("镜头 4");
  });

  it("offers only supported zoom presets, always including the minimum", () => {
    expect(zoomPresets(1, 8)).toEqual([1, 2]);
    expect(zoomPresets(0.5, 10)).toEqual([0.5, 0.6, 1, 2]);
    expect(zoomPresets(0.6, 4)).toEqual([0.6, 1, 2]);
    expect(zoomPresets(0.55, 4)).toEqual([0.55, 0.6, 1, 2]);
    expect(zoomPresets(0.7, 4)).toEqual([0.7, 1, 2]);
  });
});

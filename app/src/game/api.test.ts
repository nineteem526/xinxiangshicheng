import { afterEach, describe, expect, it, vi } from "vitest";
import { parseLevel, requestLevel } from "./api";

const good = {
  object: "水杯", fantasyName: "量子能量核心", theme: "赛博科幻", mission: "稳定核心", story: "故事",
  duration: 60, difficulty: 2, weakness: "Closed_Fist", accent: "#00f0ff",
  lines: { start: "a", success: "b", failure: "c" }, source: "ai",
};
afterEach(() => vi.unstubAllGlobals());

describe("parseLevel", () => {
  it("accepts a valid level", () => expect(parseLevel(good)?.fantasyName).toBe("量子能量核心"));
  it("rejects out-of-range or unknown values", () => {
    for (const bad of [{ duration: 200 }, { difficulty: 4 }, { weakness: "Thumb_Up" }, { accent: "#111111" }, { source: "preset" }, { story: "<b>x" }])
      expect(parseLevel({ ...good, ...bad })).toBeNull();
  });
});

describe("requestLevel", () => {
  it("returns the level on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, level: good }) })));
    const r = await requestLevel({ object: "水杯" });
    expect(r.ok && r.level.source).toBe("ai");
  });
  it("reports backend refusal and network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: false, error: "模型请求超时" }) })));
    expect(await requestLevel({ object: "x" })).toEqual({ ok: false, error: "模型请求超时" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("down"); }));
    const r = await requestLevel({ object: "x" });
    expect(r.ok).toBe(false);
  });
});

describe("parseLevel · rifts", () => {
  const rift = { object: "水杯", fantasyName: "量子核心", weakness: "Closed_Fist", box: [180, 80, 330, 190] };
  it("accepts 1..4 valid rifts", () => {
    const l = parseLevel({ ...good, rifts: [rift, { ...rift, object: "手机" }] });
    expect(l?.rifts?.length).toBe(2);
    expect(l?.rifts?.[0].box).toEqual([180, 80, 330, 190]);
  });
  it("keeps a known trait and rejects an unknown one", () => {
    expect(parseLevel({ ...good, rifts: [{ ...rift, trait: "barrier" }] })?.rifts?.[0].trait).toBe("barrier");
    expect(parseLevel({ ...good, rifts: [rift] })?.rifts?.[0].trait).toBeUndefined();
    for (const bad of ["fireball", "", 3, null, ["plain"]]) expect(parseLevel({ ...good, rifts: [{ ...rift, trait: bad }] })).toBeNull();
  });
  it("rejects bad rifts", () => {
    for (const bad of [[], Array(5).fill(rift), [{ ...rift, box: [0, 0, 10, 10] }], [{ ...rift, box: [0, 0, 2000, 500] }], [{ ...rift, weakness: "Thumb_Up" }], [{ ...rift, box: [1, 2, 3] }]])
      expect(parseLevel({ ...good, rifts: bad })).toBeNull();
  });
});

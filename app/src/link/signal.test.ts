import { describe, expect, it } from "vitest";
import { parseSignal } from "./signal";

describe("parseSignal", () => {
  it("accepts the whitelisted shapes", () => {
    expect(parseSignal(JSON.stringify({ type: "offer", sdp: "v=0" }))).toEqual({ type: "offer", sdp: "v=0" });
    expect(parseSignal(JSON.stringify({ type: "ice", candidate: null }))).toEqual({ type: "ice", candidate: null });
    expect(parseSignal(JSON.stringify({ type: "ice", candidate: { candidate: "candidate:1" } }))?.type).toBe("ice");
    expect(parseSignal(JSON.stringify({ type: "room", code: "012345" }))).toEqual({ type: "room", code: "012345" });
    expect(parseSignal(JSON.stringify({ type: "meta", facing: "environment" }))).toEqual({ type: "meta", facing: "environment" });
    expect(parseSignal(JSON.stringify({ type: "joined" }))).toEqual({ type: "joined" });
  });

  it("drops anything else", () => {
    for (const bad of [
      "not json", "null", "[]", 5, null,
      JSON.stringify({ type: "offer" }),
      JSON.stringify({ type: "offer", sdp: "" }),
      JSON.stringify({ type: "ice", candidate: { nope: 1 } }),
      JSON.stringify({ type: "room", code: "12345" }),
      JSON.stringify({ type: "room", code: "abcdef" }),
      JSON.stringify({ type: "meta", facing: "up" }),
      JSON.stringify({ type: "exec", cmd: "x" }),
      JSON.stringify({ type: "offer", sdp: "x".repeat(70_000) }),
    ])
      expect(parseSignal(bad)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { createInitialState, reducer } from "./engine";
import { PRESET_LEVELS } from "./levels";
import { GestureStabilizer } from "../vision/stabilizer";
import type { Action, GameState } from "./types";

const run = (s: GameState, ...a: Action[]) => a.reduce(reducer, s);
const started = () => run(createInitialState(), { type: "START" });
const advance = (s: GameState, ms: number, step = 100) => {
  for (let t = 0; t < ms && s.phase === "playing"; t += step) s = reducer(s, { type: "TICK", dt: step });
  return s;
};

describe("engine", () => {
  it("starts in idle and ignores gestures until started", () => {
    const s = createInitialState();
    expect(reducer(s, { type: "GESTURE", gesture: "Closed_Fist" })).toBe(s);
  });

  it("fist damages the anomaly and builds energy", () => {
    const s = run(started(), { type: "GESTURE", gesture: "Closed_Fist" });
    expect(s.hp).toBeLessThan(100);
    expect(s.energy).toBeGreaterThan(0);
  });

  it("special fails without full energy and works with it", () => {
    expect(run(started(), { type: "GESTURE", gesture: "Victory" }).event?.type).toBe("special_fail");
    let s = started();
    for (let i = 0; i < 4; i++) s = reducer(s, { type: "GESTURE", gesture: "Closed_Fist" });
    expect(s.energy).toBe(100);
    const hp = s.hp;
    s = reducer(s, { type: "GESTURE", gesture: "Victory" });
    expect(s.energy).toBe(0);
    expect(s.hp).toBeLessThan(hp);
  });

  it("an unblocked wave reduces stability", () => {
    const s = advance(started(), 8000);
    expect(s.stability).toBeLessThan(100);
    expect(s.stats.hits).toBeGreaterThan(0);
  });

  it("open palm blocks an incoming wave", () => {
    let s = advance(started(), 4100, 50);
    expect(s.wave).not.toBeNull();
    s = reducer(s, { type: "GESTURE", gesture: "Open_Palm" });
    expect(s.wave).toBeNull();
    expect(s.stats.blocked).toBe(1);
    expect(s.stability).toBe(100);
  });

  it("shield absorbs the next wave", () => {
    let s = advance(started(), 3500, 50);
    s = reducer(s, { type: "GESTURE", gesture: "Open_Palm" });
    expect(s.shieldMs).toBeGreaterThan(0);
    s = advance(s, 1000, 50);
    expect(s.stats.blocked).toBe(1);
    expect(s.stability).toBe(100);
  });

  it("wins when anomaly hp reaches 0", () => {
    let s = started();
    for (let i = 0; i < 12 && s.phase === "playing"; i++) s = reducer(s, { type: "GESTURE", gesture: "Closed_Fist" });
    expect(s.phase).toBe("success");
  });

  it("loses by stability collapse if the player does nothing", () => {
    const s = advance(started(), 61000);
    expect(s.phase).toBe("failure");
    expect(s.stability).toBe(0);
  });

  it("loses when time runs out while the player only defends", () => {
    let s = started();
    for (let t = 0; t < 61000 && s.phase === "playing"; t += 50) {
      s = reducer(s, { type: "TICK", dt: 50 });
      if (s.wave) s = reducer(s, { type: "GESTURE", gesture: "Open_Palm" });
    }
    expect(s.phase).toBe("failure");
    expect(s.timeLeft).toBe(0);
    expect(s.stability).toBeGreaterThan(0);
  });

  it("loses when stability hits 0 and ignores later input", () => {
    let s = started();
    s = { ...s, stability: 10 };
    s = advance(s, 20000);
    expect(s.phase).toBe("failure");
    expect(reducer(s, { type: "GESTURE", gesture: "Closed_Fist" })).toBe(s);
  });

  it("reset returns to idle with a fresh state", () => {
    const s = run(started(), { type: "GESTURE", gesture: "Closed_Fist" }, { type: "RESET" });
    expect(s.phase).toBe("idle");
    expect(s.hp).toBe(100);
  });

  it("event ids increase so the UI can react to repeats", () => {
    const a = run(started(), { type: "GESTURE", gesture: "Closed_Fist" });
    const b = reducer(a, { type: "GESTURE", gesture: "Closed_Fist" });
    expect(b.event!.id).toBeGreaterThan(a.event!.id);
  });

  it("every preset level is winnable with fists alone, and has distinct content", () => {
    const names = new Set<string>();
    for (const lv of PRESET_LEVELS) {
      names.add(lv.fantasyName);
      let s = run(createInitialState(lv), { type: "START" });
      for (let i = 0; i < 15 && s.phase === "playing"; i++) s = reducer(s, { type: "GESTURE", gesture: "Closed_Fist" });
      expect(s.phase).toBe("success");
    }
    expect(names.size).toBe(PRESET_LEVELS.length);
  });
});

describe("GestureStabilizer", () => {
  it("does not fire before the stable time", () => {
    const st = new GestureStabilizer();
    expect(st.update("Closed_Fist", 0.9, 0)).toBeNull();
    expect(st.update("Closed_Fist", 0.9, 200)).toBeNull();
    expect(st.update("Closed_Fist", 0.9, 400)).toBe("Closed_Fist");
  });

  it("ignores low confidence and unknown gestures", () => {
    const st = new GestureStabilizer();
    for (let t = 0; t < 1000; t += 50) {
      expect(st.update("Closed_Fist", 0.3, t)).toBeNull();
      expect(st.update("Thumb_Up", 0.99, t)).toBeNull();
    }
  });

  it("resets the timer when the gesture changes", () => {
    const st = new GestureStabilizer();
    st.update("Closed_Fist", 0.9, 0);
    st.update("Open_Palm", 0.9, 300);
    expect(st.update("Open_Palm", 0.9, 500)).toBeNull();
    expect(st.update("Open_Palm", 0.9, 700)).toBe("Open_Palm");
  });

  it("keeps the hold timer through a single dropped frame, but not a long gap", () => {
    const st = new GestureStabilizer();
    st.update("Closed_Fist", 0.9, 0);
    expect(st.update(null, 0, 80)).toBeNull(); // one frame of no hand / low score
    expect(st.update("Closed_Fist", 0.9, 230)).toBe("Closed_Fist"); // timer was not reset
    const st2 = new GestureStabilizer();
    st2.update("Closed_Fist", 0.9, 0);
    st2.update(null, 0, 50);
    st2.update(null, 0, 400); // gap longer than graceMs resets
    expect(st2.update("Closed_Fist", 0.9, 450)).toBeNull();
  });

  it("respects the cooldown when a gesture is held", () => {
    const st = new GestureStabilizer({ minScore: 0.6, stableMs: 300, cooldownMs: 1000, graceMs: 0 });
    const fires: number[] = [];
    for (let t = 0; t <= 3000; t += 50) if (st.update("Victory", 0.9, t)) fires.push(t);
    expect(fires.length).toBeGreaterThanOrEqual(2);
    expect(fires.length).toBeLessThanOrEqual(4);
    for (let i = 1; i < fires.length; i++) expect(fires[i] - fires[i - 1]).toBeGreaterThanOrEqual(1000);
  });
});

describe("engine · scene mode (rifts anchored to real objects)", () => {
  const rift = (object: string, weakness: "Open_Palm" | "Closed_Fist" | "Victory") => ({
    object, fantasyName: object, weakness, box: [100, 100, 400, 400] as [number, number, number, number],
  });
  const sceneLevel = { ...PRESET_LEVELS[0], rifts: [rift("水杯", "Closed_Fist"), rift("手机", "Victory")] };
  const start = () => run(createInitialState(sceneLevel), { type: "START" });

  it("fist without a rift under the hand is a miss", () => {
    const s = reducer(start(), { type: "GESTURE", gesture: "Closed_Fist" });
    expect(s.event?.type).toBe("miss");
    expect(s.hp).toBe(100);
  });

  it("fist on a rift damages only that rift; anomaly hp is the mean", () => {
    const s = reducer(start(), { type: "GESTURE", gesture: "Closed_Fist", riftIndex: 1 });
    expect(s.rifts[1].hp).toBe(75);
    expect(s.rifts[0].hp).toBe(100);
    expect(s.hp).toBe(87.5);
    expect(s.event?.riftIndex).toBe(1);
  });

  it("weakness doubles damage and a rift seals at 0, then is no longer a target", () => {
    let s = reducer(start(), { type: "GESTURE", gesture: "Closed_Fist", riftIndex: 0 });
    expect(s.rifts[0].hp).toBe(50);
    s = reducer(s, { type: "GESTURE", gesture: "Closed_Fist", riftIndex: 0 });
    expect(s.rifts[0].hp).toBe(0);
    expect(s.event?.type).toBe("rift_sealed");
    expect(s.phase).toBe("playing");
    expect(reducer(s, { type: "GESTURE", gesture: "Closed_Fist", riftIndex: 0 }).event?.type).toBe("miss");
  });

  it("sealing every rift wins", () => {
    let s = start();
    s = reducer(s, { type: "GESTURE", gesture: "Closed_Fist", riftIndex: 0 });
    s = reducer(s, { type: "GESTURE", gesture: "Closed_Fist", riftIndex: 0 });
    for (let i = 0; i < 4; i++) s = reducer(s, { type: "GESTURE", gesture: "Closed_Fist", riftIndex: 1 });
    expect(s.phase).toBe("success");
  });

  it("palm still blocks waves regardless of rifts", () => {
    let s = advance(start(), 4100);
    expect(s.wave).not.toBeNull();
    s = reducer(s, { type: "GESTURE", gesture: "Open_Palm" });
    expect(s.event?.type).toBe("block");
  });

  it("classic levels without rifts are unchanged", () => {
    const s = reducer(started(), { type: "GESTURE", gesture: "Closed_Fist" });
    expect(s.event?.type).toBe("fist");
    expect(s.rifts).toEqual([]);
  });
});

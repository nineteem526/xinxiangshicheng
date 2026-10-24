// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// No camera/WebGL in CI: stub the vision hooks. The game itself is real.
vi.mock("./vision/useGestures", () => ({
  useGestures: () => ({
    model: "ready",
    modelError: null,
    live: { name: "None", score: 0, hand: false, progress: 0, inferMs: 0 },
    fps: 0,
  }),
}));
vi.mock("./game/sfx", () => ({ playSfx: vi.fn(), setMuted: vi.fn(), unlockAudio: vi.fn() }));
vi.mock("./ui/RiftLayer", () => ({ RiftLayer: () => null })); // canvas-free in jsdom

import App from "./App";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const press = (key: string) => fireEvent.keyDown(window, { key });
/** Space starts a 3-2-1 countdown; this presses it and lets the countdown finish. */
const begin = (key = " ") => {
  press(key);
  // Each tick re-arms its own timer after React re-renders, so step through them one by one.
  for (let i = 0; i < 3; i++)
    act(() => {
      vi.advanceTimersByTime(800);
    });
};

describe("App (keyboard fallback)", () => {
  it("shows the intro, then plays and wins a round with the keyboard", () => {
    render(<App />);
    expect(screen.getByText(/60 秒封印战/)).toBeTruthy();
    expect(screen.getAllByText(/预设数据/).length).toBeGreaterThan(0);

    begin();
    expect(screen.getByText("60")).toBeTruthy();

    for (let i = 0; i < 12; i++) press("2");
    expect(screen.getByText("封印成功")).toBeTruthy();

    press("r");
    expect(screen.getByText(/60 秒封印战/)).toBeTruthy();
  });

  it("shows a failure screen when the player does nothing", () => {
    render(<App />);
    begin("Enter");
    act(() => {
      vi.advanceTimersByTime(40000);
    });
    expect(screen.getByText("现实已被入侵")).toBeTruthy();
  });

  it("a wave appears and open palm (key 1) blocks it", () => {
    render(<App />);
    begin();
    act(() => {
      vi.advanceTimersByTime(4300);
    });
    expect(screen.getByRole("alert").textContent).toMatch(/入侵波来袭,张开手掌防御/);
    press("1");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores gesture keys before the game starts", () => {
    render(<App />);
    press("2");
    expect(screen.getByText(/60 秒封印战/)).toBeTruthy();
  });

  it("scene mode: a manual level with rifts is beaten by sealing every rift from the keyboard", async () => {
    const rift = (object: string, weakness: string) => ({ object, fantasyName: `幻${object}`, weakness, box: [100, 100, 400, 400] });
    const level = {
      object: "水杯、手机", fantasyName: "幻水杯", theme: "t", mission: "m", story: "s", duration: 60, difficulty: 1,
      weakness: "Closed_Fist", accent: "#00f0ff", lines: { start: "a", success: "b", failure: "c" }, source: "manual",
      rifts: [rift("水杯", "Closed_Fist"), rift("手机", "Victory")],
    };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, level }) })));
    render(<App />);
    fireEvent.change(screen.getByLabelText("手动输入物品名"), { target: { value: "水杯" } });
    await act(async () => {
      fireEvent.click(screen.getByText("生成关卡"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(/已定位 2 个入侵点/)).toBeTruthy();
    begin();
    expect(screen.getByText(/2 个入侵点锚定在真实物品上/)).toBeTruthy();
    // keyboard targets the first unsealed rift: 2 fists seal 水杯 (weakness ×2), then 4 seal 手机
    for (let i = 0; i < 6; i++) press("2");
    expect(screen.getByText("封印成功")).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("space starts a 3-2-1 countdown first; the clock does not run until it ends", () => {
    render(<App />);
    const num = () => document.querySelector(".countdown b")?.textContent;
    press(" ");
    expect(num()).toBe("3");
    expect(screen.queryByText(/60 秒封印战/)).toBeNull(); // intro is hidden while counting
    press("2"); // gestures are ignored before the game starts
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(num()).toBe("2");
    press(" "); // a second press must not restart or skip the countdown
    expect(num()).toBe("2");
    for (let i = 0; i < 2; i++)
      act(() => {
        vi.advanceTimersByTime(800);
      });
    expect(num()).toBeUndefined();
    expect(document.querySelector(".timer")?.textContent).toBe("60");
  });

  it("R cancels the countdown and returns to the intro", () => {
    render(<App />);
    press(" ");
    press("r");
    expect(screen.getByText(/60 秒封印战/)).toBeTruthy();
  });
});

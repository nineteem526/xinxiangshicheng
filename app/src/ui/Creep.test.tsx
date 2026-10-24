// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Creep, noise } from "./Creep";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("noise", () => {
  it("is deterministic, the requested length, and varies with the seed", () => {
    expect(noise(40, 3)).toBe(noise(40, 3));
    expect(noise(40, 3)).toHaveLength(40);
    expect(noise(40, 3)).not.toBe(noise(40, 4));
  });
});

describe("Creep", () => {
  it("is decorative: hidden from assistive tech and never receives clicks", () => {
    const { container } = render(<Creep danger={0.2} playing />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("aria-hidden")).toBe("true");
  });

  it("exposes the danger level as a CSS variable the stylesheet reads", () => {
    const { container } = render(<Creep danger={0.456} playing />);
    expect((container.firstElementChild as HTMLElement).style.getPropertyValue("--danger")).toBe("0.46");
  });

  it("scrambles its text while playing, and stays still when not", () => {
    const text = (el: HTMLElement) => el.querySelector(".garble.top")!.textContent;
    const a = render(<Creep danger={0} playing />);
    const before = text(a.container.firstElementChild as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(text(a.container.firstElementChild as HTMLElement)).not.toBe(before);
    a.unmount();

    const b = render(<Creep danger={0} playing={false} />);
    const still = text(b.container.firstElementChild as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(text(b.container.firstElementChild as HTMLElement)).toBe(still);
  });

  it("gets longer and faster as danger rises", () => {
    const calm = render(<Creep danger={0} playing={false} />);
    const calmLen = calm.container.querySelector(".garble.top")!.textContent!.length;
    calm.unmount();
    const bad = render(<Creep danger={1} playing={false} />);
    expect(bad.container.querySelector(".garble.top")!.textContent!.length).toBeGreaterThan(calmLen);
  });
});

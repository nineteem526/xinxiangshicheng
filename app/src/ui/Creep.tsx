import { useEffect, useState } from "react";

const GLYPHS = "01ｱｲｳｴｵｶｷｸｹｺ▒░▓█▌▐#%&$@!?<>/\\|=+*~";

/** A fixed-length string of noise. Deterministic given a seed so tests and snapshots stay stable. */
export function noise(len: number, seed: number): string {
  let out = "";
  let x = seed * 9301 + 49297;
  for (let i = 0; i < len; i++) {
    x = (x * 233280 + 49297) % 2147483647;
    out += GLYPHS[x % GLYPHS.length];
  }
  return out;
}

interface Props {
  /** 0..1: how far the corruption has crept in (rises as stability falls). */
  danger: number;
  /** Frozen on idle screens, which would otherwise have nothing to infect. */
  playing: boolean;
}

/**
 * The intrusion bleeding into the interface: red creeps in from the edges, torn bands flicker across,
 * and a strip of garbled characters runs along the top and bottom. Purely decorative (aria-hidden).
 * Intensity is driven by the --danger custom property, so the browser animates it without re-renders.
 */
export function Creep({ danger, playing }: Props) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!playing) return;
    // Slow enough to read as glitching, fast enough to feel alive; faster as danger rises.
    const id = setInterval(() => setTick((t) => t + 1), 260 - Math.round(danger * 140));
    return () => clearInterval(id);
  }, [playing, danger]);

  const len = 46 + Math.round(danger * 60);
  return (
    <div className="creep" style={{ ["--danger" as string]: danger.toFixed(2) }} aria-hidden>
      <i />
      <i />
      <i />
      <i />
      <div className="garble top">{noise(len, tick)}</div>
      <div className="garble bottom">{noise(len, tick + 9000)}</div>
    </div>
  );
}

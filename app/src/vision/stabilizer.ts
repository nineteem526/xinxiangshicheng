import { GESTURES, type GestureName } from "../game/types";

export interface StabilizerConfig {
  minScore: number; // confidence threshold
  stableMs: number; // gesture must be held this long
  cooldownMs: number; // min gap between two triggers
  graceMs: number; // a dropped / flickering frame shorter than this does not reset the hold timer
}

export const DEFAULT_STABILIZER: StabilizerConfig = { minScore: 0.6, stableMs: 220, cooldownMs: 600, graceMs: 140 };

const isGesture = (n: string | null): n is GestureName => !!n && (GESTURES as readonly string[]).includes(n);

/**
 * Turns noisy per-frame classifications into discrete trigger events.
 * Holding the same gesture re-fires after the cooldown, so repeated attacks are possible.
 */
export class GestureStabilizer {
  private cand: GestureName | null = null;
  private since = 0;
  private lastFire = -Infinity;
  private lostSince: number | null = null;

  constructor(private cfg: StabilizerConfig = DEFAULT_STABILIZER) {}

  /** Progress 0..1 of the current candidate toward triggering (for HUD). */
  progress(now: number): number {
    if (!this.cand) return 0;
    return Math.min(1, (now - this.since) / this.cfg.stableMs);
  }

  update(name: string | null, score: number, now: number): GestureName | null {
    const valid = isGesture(name) && score >= this.cfg.minScore ? name : null;
    if (valid !== this.cand) {
      // Brief flicker (one bad frame) while holding a gesture: keep the timer running.
      if (this.cand && (valid === null || valid === this.cand)) {
        this.lostSince ??= now;
        if (valid === null && now - this.lostSince < this.cfg.graceMs) return null;
      }
      this.cand = valid;
      this.since = now;
      this.lostSince = null;
      return null;
    }
    this.lostSince = null;
    if (!valid) return null;
    if (now - this.since >= this.cfg.stableMs && now - this.lastFire >= this.cfg.cooldownMs) {
      this.lastFire = now;
      this.since = now;
      return valid;
    }
    return null;
  }

  setMinScore(n: number) {
    this.cfg = { ...this.cfg, minScore: n };
  }

  /** Gesture currently being held (for UI), or null. */
  candidate(): GestureName | null {
    return this.cand;
  }

  reset() {
    this.lostSince = null;
    this.cand = null;
    this.lastFire = -Infinity;
  }
}

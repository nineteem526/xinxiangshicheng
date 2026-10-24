import type { Trait } from "./types";

/**
 * Per-object behaviours. The model may only pick a name from TRAITS; every number below is ours.
 * Each one changes what the player must DO, not just how it looks:
 *   plain    hit it
 *   barrier  open palm breaks the shield first, then it can be hurt
 *   charge   keep striking: energy builds and decays, only a full charge deals real damage
 *   phase    invulnerable except for a short window that opens on a timer
 *   combo    land several hits in a row before the chain times out, or it heals back
 */
export const TRAITS: readonly Trait[] = ["plain", "barrier", "charge", "phase", "combo"] as const;

export const TRAIT_LABEL: Record<Trait, string> = {
  plain: "普通",
  barrier: "护盾",
  charge: "蓄力",
  phase: "相位",
  combo: "连击",
};

/** One line the player can read in a second. Shown on the object's tag and in the side list. */
export const TRAIT_HINT: Record<Trait, string> = {
  plain: "直接攻击",
  barrier: "先用张开手掌击碎护盾",
  charge: "连续出拳攒满蓄力,再爆发",
  phase: "只在窗口打开时能被攻击",
  combo: "限时内连续命中,断了会回血",
};

export const BARRIER_HP = 100;
export const BARRIER_PALM_DAMAGE = 34; // 3 open-palm hits break it; once broken it stays down

export const CHARGE_PER_HIT = 34; // 3 hits fill it
export const CHARGE_DECAY_PER_S = 18; // lose this much per second of not striking
export const CHARGE_BURST_DAMAGE = 55;
export const CHARGE_CHIP_DAMAGE = 2; // hits before a full charge barely scratch it

export const PHASE_PERIOD_MS = 4200;
export const PHASE_OPEN_MS = 1700;

export const COMBO_NEED = 3;
export const COMBO_WINDOW_MS = 1800;
export const COMBO_HIT_DAMAGE = 6;
export const COMBO_FINISH_DAMAGE = 30; // the hit that completes a chain
export const COMBO_HEAL_ON_BREAK = 12;

export function isTrait(v: unknown): v is Trait {
  return typeof v === "string" && (TRAITS as readonly string[]).includes(v);
}

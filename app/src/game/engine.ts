import { DEFAULT_LEVEL } from "./levels";
import {
  BARRIER_HP, BARRIER_PALM_DAMAGE, CHARGE_BURST_DAMAGE, CHARGE_CHIP_DAMAGE, CHARGE_DECAY_PER_S, CHARGE_PER_HIT,
  COMBO_FINISH_DAMAGE, COMBO_HEAL_ON_BREAK, COMBO_HIT_DAMAGE, COMBO_NEED, COMBO_WINDOW_MS, PHASE_OPEN_MS, PHASE_PERIOD_MS,
} from "./traits";
import type { Action, GameState, GestureName, Level, EventType, Rift, RiftState } from "./types";

/** All rules live here and are deterministic. The LLM never decides outcomes. */
const WAVE_INTERVAL = [0, 6000, 5000, 4000];
const WAVE_WINDOW = [0, 3500, 3000, 2500];
const WAVE_DAMAGE = [0, 15, 20, 25];

const FIST_DAMAGE = 12;
const FIST_ENERGY = 25;
const SPECIAL_DAMAGE = 40;
const BLOCK_ENERGY = 10;
const SHIELD_MS = 2000;
const FIRST_WAVE_MS = 4000;
/** Scene mode: per-rift damage is higher so 2–4 rifts stay beatable in the same time. */
const RIFT_FIST_DAMAGE = 25;
const RIFT_SPECIAL_DAMAGE = 60;

function initRift(r: Rift, i: number): RiftState {
  const trait = r.trait ?? "plain";
  return {
    ...r,
    trait,
    hp: 100,
    barrier: trait === "barrier" ? BARRIER_HP : 0,
    charge: 0,
    // Stagger the phase objects so two of them are not open at the same instant.
    phaseAt: trait === "phase" ? (i * PHASE_PERIOD_MS * 0.37) % PHASE_PERIOD_MS : 0,
    chain: 0,
    chainMs: 0,
  };
}

/**
 * Which object the keyboard fallback should aim at for gesture `g`: the first live one that gesture
 * can actually affect right now. Without this, a shielded or phase-locked first object would make a
 * keyboard-only game unwinnable.
 */
export function keyboardTarget(rifts: RiftState[], g: GestureName): number | undefined {
  const live = rifts.map((r, i) => ({ r, i })).filter(({ r }) => r.hp > 0);
  if (g === "Open_Palm") return live.find(({ r }) => r.trait === "barrier" && r.barrier > 0)?.i;
  const hittable = live.find(({ r }) => !(r.trait === "barrier" && r.barrier > 0) && isOpen(r));
  if (hittable) return hittable.i;
  // Nothing is hittable this instant (e.g. everything is shielded or locked): aim at the first live one.
  return live[0]?.i;
}

/** Is a phase object currently hittable? Other traits are always hittable. */
export function isOpen(r: RiftState): boolean {
  return r.trait !== "phase" || r.phaseAt < PHASE_OPEN_MS;
}

export function createInitialState(level: Level = DEFAULT_LEVEL): GameState {
  return {
    phase: "idle",
    level,
    rifts: (level.rifts ?? []).map(initRift),
    timeLeft: level.duration * 1000,
    stability: 100,
    energy: 0,
    hp: 100,
    wave: null,
    nextWaveIn: FIRST_WAVE_MS,
    shieldMs: 0,
    stats: { blocked: 0, hits: 0, actions: 0 },
    event: null,
  };
}

function emit(s: GameState, type: EventType, riftIndex?: number): GameState {
  return { ...s, event: { id: (s.event?.id ?? 0) + 1, type, riftIndex } };
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));
const sceneMode = (s: GameState) => s.rifts.length > 0;

function block(s: GameState): GameState {
  const bonus = s.level.weakness === "Open_Palm" ? 25 : BLOCK_ENERGY;
  return emit(
    { ...s, wave: null, energy: clamp(s.energy + bonus), stats: { ...s.stats, blocked: s.stats.blocked + 1 } },
    "block",
  );
}

function finish(s: GameState): GameState {
  if (s.hp <= 0) return emit({ ...s, phase: "success", wave: null }, "success");
  if (s.stability <= 0 || s.timeLeft <= 0) return emit({ ...s, phase: "failure", wave: null, timeLeft: Math.max(0, s.timeLeft) }, "failure");
  return s;
}

function tick(s: GameState, dt: number): GameState {
  if (s.phase !== "playing") return s;
  const d = s.level.difficulty;
  let n: GameState = { ...s, timeLeft: s.timeLeft - dt, shieldMs: Math.max(0, s.shieldMs - dt) };

  if (n.wave) {
    const remaining = n.wave.remaining - dt;
    if (remaining <= 0) {
      n = emit(
        { ...n, wave: null, stability: clamp(n.stability - WAVE_DAMAGE[d]), stats: { ...n.stats, hits: n.stats.hits + 1 } },
        "hit",
      );
    } else {
      n = { ...n, wave: { ...n.wave, remaining } };
    }
  } else {
    const next = n.nextWaveIn - dt;
    if (next <= 0) {
      n = { ...n, nextWaveIn: WAVE_INTERVAL[d] };
      n = n.shieldMs > 0 ? block(n) : emit({ ...n, wave: { remaining: WAVE_WINDOW[d], window: WAVE_WINDOW[d] } }, "wave");
    } else {
      n = { ...n, nextWaveIn: next };
    }
  }
  n = tickRifts(n, dt);
  return finish(n);
}

/** Advance each object's own clock: charge leaks, phase cycles, a combo chain times out. */
function tickRifts(s: GameState, dt: number): GameState {
  if (!s.rifts.length) return s;
  let ev: { type: EventType; idx: number } | null = null;
  let heal = 0;
  const rifts = s.rifts.map((r, i) => {
    if (r.hp <= 0) return r;
    let x = r;
    if (r.trait === "charge" && r.charge > 0) x = { ...x, charge: Math.max(0, r.charge - (CHARGE_DECAY_PER_S * dt) / 1000) };
    if (r.trait === "phase") {
      const before = r.phaseAt;
      const at = (r.phaseAt + dt) % PHASE_PERIOD_MS;
      x = { ...x, phaseAt: at };
      if (before >= PHASE_OPEN_MS && at < PHASE_OPEN_MS) ev = { type: "phase_open", idx: i };
    }
    if (r.trait === "combo" && r.chain > 0) {
      const left = r.chainMs - dt;
      if (left <= 0) {
        // The chain timed out: it regenerates, which is what makes stopping mid-combo costly.
        x = { ...x, chain: 0, chainMs: 0, hp: Math.min(100, r.hp + COMBO_HEAL_ON_BREAK) };
        heal += 1;
        ev = { type: "combo_break", idx: i };
      } else x = { ...x, chainMs: left };
    }
    return x;
  });
  let n: GameState = { ...s, rifts };
  if (heal) n = { ...n, hp: n.rifts.reduce((a, x) => a + x.hp, 0) / n.rifts.length };
  return ev ? emit(n, (ev as { type: EventType }).type, (ev as { idx: number }).idx) : n;
}

/** Apply damage to one rift; anomaly hp becomes the mean of all rifts. */
function damageRift(s: GameState, idx: number, dmg: number, type: EventType): GameState {
  const r = s.rifts[idx];
  const hp = clamp(r.hp - dmg);
  const rifts: RiftState[] = s.rifts.map((x, i) => (i === idx ? { ...x, hp } : x));
  const total = rifts.reduce((a, x) => a + x.hp, 0) / rifts.length;
  const n = { ...s, rifts, hp: total };
  return emit(n, hp === 0 && r.hp > 0 ? "rift_sealed" : type, idx);
}

function gesture(s: GameState, g: GestureName, riftIndex?: number): GameState {
  if (s.phase !== "playing") return s;
  const acted: GameState = { ...s, stats: { ...s.stats, actions: s.stats.actions + 1 } };

  if (g === "Open_Palm") {
    // On a live barrier object, an open palm breaks its shield instead of defending.
    const t = riftIndex !== undefined ? acted.rifts[riftIndex] : undefined;
    if (t && t.hp > 0 && t.trait === "barrier" && t.barrier > 0) return breakBarrier(acted, riftIndex!);
    if (acted.wave) return block(acted);
    return emit({ ...acted, shieldMs: SHIELD_MS }, "shield");
  }

  if (sceneMode(acted)) {
    // Attacks must land on a live rift under the hand.
    const r = riftIndex !== undefined ? acted.rifts[riftIndex] : undefined;
    if (!r || r.hp <= 0) return emit(acted, "miss");
    if (g === "Closed_Fist") return finish(strikeRift(acted, riftIndex!, g));
    if (acted.energy < 100) return emit(acted, "special_fail");
    // The special ignores barrier and phase: it is the answer to an object you cannot otherwise touch.
    const dmg = r.weakness === "Victory" ? RIFT_SPECIAL_DAMAGE * 1.5 : RIFT_SPECIAL_DAMAGE;
    return finish(damageRift({ ...acted, energy: 0 }, riftIndex!, dmg, "special"));
  }

  if (g === "Closed_Fist") {
    const dmg = s.level.weakness === "Closed_Fist" ? FIST_DAMAGE * 2 : FIST_DAMAGE;
    return finish(emit({ ...acted, hp: clamp(acted.hp - dmg), energy: clamp(acted.energy + FIST_ENERGY) }, "fist"));
  }
  // Victory: special skill, needs full energy
  if (acted.energy < 100) return emit(acted, "special_fail");
  const dmg = s.level.weakness === "Victory" ? SPECIAL_DAMAGE * 1.5 : SPECIAL_DAMAGE;
  return finish(emit({ ...acted, hp: clamp(acted.hp - dmg), energy: 0 }, "special"));
}

function setRift(s: GameState, idx: number, patch: Partial<RiftState>): GameState {
  const rifts = s.rifts.map((x, i) => (i === idx ? { ...x, ...patch } : x));
  return { ...s, rifts };
}

function breakBarrier(s: GameState, idx: number): GameState {
  const r = s.rifts[idx];
  const barrier = Math.max(0, r.barrier - BARRIER_PALM_DAMAGE);
  const n = setRift(s, idx, { barrier });
  return emit(n, barrier === 0 ? "shield_break" : "shield_hit", idx);
}

/** A fist on a live object. What it does depends on that object's trait. */
function strikeRift(s: GameState, idx: number, _g: GestureName): GameState {
  const r = s.rifts[idx];
  const base = r.weakness === "Closed_Fist" ? RIFT_FIST_DAMAGE * 2 : RIFT_FIST_DAMAGE;
  const energy = clamp(s.energy + FIST_ENERGY);
  const withEnergy: GameState = { ...s, energy };

  switch (r.trait) {
    case "barrier":
      // A fist bounces off an intact shield: the player has to switch to an open palm.
      if (r.barrier > 0) return emit(withEnergy, "locked", idx);
      return damageRift(withEnergy, idx, base, "fist");

    case "phase":
      if (!isOpen(r)) return emit({ ...s }, "locked", idx);
      return damageRift(withEnergy, idx, base, "fist");

    case "charge": {
      // Each fist adds charge; only a full charge hits hard, and it empties when it does.
      const charge = r.charge + CHARGE_PER_HIT;
      if (charge >= 100) {
        const n = setRift(withEnergy, idx, { charge: 0 });
        return damageRift(n, idx, CHARGE_BURST_DAMAGE * (r.weakness === "Closed_Fist" ? 1.4 : 1), "charge_burst");
      }
      return damageRift(setRift(withEnergy, idx, { charge }), idx, CHARGE_CHIP_DAMAGE, "fist");
    }

    case "combo": {
      const chain = r.chain + 1;
      if (chain >= COMBO_NEED) {
        const n = setRift(withEnergy, idx, { chain: 0, chainMs: 0 });
        return damageRift(n, idx, COMBO_FINISH_DAMAGE * (r.weakness === "Closed_Fist" ? 1.6 : 1), "combo_hit");
      }
      const n = setRift(withEnergy, idx, { chain, chainMs: COMBO_WINDOW_MS });
      return damageRift(n, idx, COMBO_HIT_DAMAGE, "combo_hit");
    }

    default:
      return damageRift(withEnergy, idx, base, "fist");
  }
}

export function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case "START":
      return emit({ ...createInitialState(action.level ?? state.level), phase: "playing", event: state.event }, "start");
    case "RESET":
      return { ...createInitialState(action.level ?? state.level), event: state.event };
    case "TICK":
      return tick(state, action.dt);
    case "GESTURE":
      return gesture(state, action.gesture, action.riftIndex);
  }
}

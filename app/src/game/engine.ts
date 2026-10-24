import { DEFAULT_LEVEL } from "./levels";
import type { Action, GameState, GestureName, Level, EventType, RiftState } from "./types";

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

export function createInitialState(level: Level = DEFAULT_LEVEL): GameState {
  return {
    phase: "idle",
    level,
    rifts: (level.rifts ?? []).map((r) => ({ ...r, hp: 100 })),
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
  return finish(n);
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
    if (acted.wave) return block(acted);
    return emit({ ...acted, shieldMs: SHIELD_MS }, "shield");
  }

  if (sceneMode(acted)) {
    // Attacks must land on a live rift under the hand.
    const r = riftIndex !== undefined ? acted.rifts[riftIndex] : undefined;
    if (!r || r.hp <= 0) return emit(acted, "miss");
    if (g === "Closed_Fist") {
      const dmg = r.weakness === "Closed_Fist" ? RIFT_FIST_DAMAGE * 2 : RIFT_FIST_DAMAGE;
      return finish(damageRift({ ...acted, energy: clamp(acted.energy + FIST_ENERGY) }, riftIndex!, dmg, "fist"));
    }
    if (acted.energy < 100) return emit(acted, "special_fail");
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

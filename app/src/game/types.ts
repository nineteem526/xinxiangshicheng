export const GESTURES = ["Open_Palm", "Closed_Fist", "Victory"] as const;
export type GestureName = (typeof GESTURES)[number];

export const GESTURE_LABEL: Record<GestureName, string> = {
  Open_Palm: "张开手掌",
  Closed_Fist: "握拳",
  Victory: "V 手势",
};

export const GESTURE_ACTION: Record<GestureName, string> = {
  Open_Palm: "防御",
  Closed_Fist: "攻击",
  Victory: "封印",
};

export const ACCENTS = ["#00f0ff", "#ff2bd6", "#7dff6b", "#ffb300", "#ff4d4d"] as const;

/** How an object fights back. A closed list: the model picks a name, the engine owns the rules. */
export type Trait = "plain" | "barrier" | "charge" | "phase" | "combo";

/** One real object in the camera frame that the game anchors to. box = [ymin,xmin,ymax,xmax] in 0..1000. */
export interface Rift {
  object: string;
  fantasyName: string;
  weakness: GestureName;
  /** Absent means "plain" (older saved levels, single-object mode). */
  trait?: Trait;
  box: [number, number, number, number];
}

/** Level content. Data only: the model may fill these fields but never supplies code or rules. */
export interface Level {
  object: string;
  fantasyName: string;
  theme: string;
  mission: string;
  story: string;
  duration: number; // seconds, 30..90
  difficulty: 1 | 2 | 3;
  weakness: GestureName;
  accent: string;
  lines: { start: string; success: string; failure: string };
  source: "preset" | "ai" | "manual";
  /** Multi-object scene mode. Absent = classic single-anomaly mode. */
  rifts?: Rift[];
}

export type Phase = "idle" | "playing" | "success" | "failure";

export type EventType =
  | "start"
  | "fist"
  | "block"
  | "shield"
  | "wave"
  | "hit"
  | "special"
  | "special_fail"
  | "rift_sealed"
  | "miss"
  | "shield_hit"
  | "shield_break"
  | "charge_burst"
  | "phase_open"
  | "locked"
  | "combo_hit"
  | "combo_break"
  | "success"
  | "failure";

export interface GameEvent {
  id: number;
  type: EventType;
  riftIndex?: number;
}

export interface RiftState extends Rift {
  hp: number; // 0..100, sealed at 0
  trait: Trait;
  /** barrier: shield left, 0 = broken. Other traits keep it at 0. */
  barrier: number;
  /** charge: 0..100, decays while idle. */
  charge: number;
  /** phase: ms into the current cycle. The window is open for the first PHASE_OPEN_MS of each period. */
  phaseAt: number;
  /** combo: hits in the current chain, and ms left before the chain breaks. */
  chain: number;
  chainMs: number;
}

export interface GameState {
  phase: Phase;
  level: Level;
  /** Per-rift hp when the level has rifts. Anomaly hp is then the average. */
  rifts: RiftState[];
  timeLeft: number; // ms
  stability: number; // 0..100
  energy: number; // 0..100
  hp: number; // anomaly hp 0..100
  wave: { remaining: number; window: number } | null;
  nextWaveIn: number;
  shieldMs: number;
  stats: { blocked: number; hits: number; actions: number };
  event: GameEvent | null;
}

export type Action =
  | { type: "START"; level?: Level }
  | { type: "TICK"; dt: number }
  | { type: "GESTURE"; gesture: GestureName; riftIndex?: number }
  | { type: "RESET"; level?: Level };

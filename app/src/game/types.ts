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

/** One real object in the camera frame that the game anchors to. box = [ymin,xmin,ymax,xmax] in 0..1000. */
export interface Rift {
  object: string;
  fantasyName: string;
  weakness: GestureName;
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
  | "success"
  | "failure";

export interface GameEvent {
  id: number;
  type: EventType;
  riftIndex?: number;
}

export interface RiftState extends Rift {
  hp: number; // 0..100, sealed at 0
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

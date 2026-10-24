import type { EventType } from "./types";

/** Synthesised with WebAudio, so there are no audio assets to ship or fail to load. */
let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(m: boolean) {
  muted = m;
}

export function unlockAudio() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
}

function tone(freq: number, dur: number, type: OscillatorType = "sine", gain = 0.12, slideTo?: number, delay = 0) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function playSfx(type: EventType) {
  switch (type) {
    case "start":
      tone(220, 0.5, "sawtooth", 0.1, 880);
      break;
    case "fist":
      tone(160, 0.18, "square", 0.14, 60);
      break;
    case "block":
      tone(660, 0.12, "triangle", 0.14, 990);
      tone(990, 0.2, "sine", 0.1, 1320, 0.08);
      break;
    case "shield":
      tone(440, 0.3, "sine", 0.1, 660);
      break;
    case "wave":
      tone(110, 0.4, "sawtooth", 0.1, 90);
      tone(120, 0.4, "square", 0.05, 100, 0.15);
      break;
    case "hit":
      tone(90, 0.35, "sawtooth", 0.2, 40);
      break;
    case "special":
      tone(300, 0.6, "sawtooth", 0.14, 1400);
      tone(1400, 0.4, "sine", 0.1, 200, 0.3);
      break;
    case "shield_hit":
      tone(520, 0.1, "triangle", 0.12, 380);
      break;
    case "shield_break":
      tone(700, 0.35, "sawtooth", 0.14, 120);
      tone(1200, 0.15, "square", 0.08, 300, 0.05);
      break;
    case "charge_burst":
      tone(120, 0.5, "sawtooth", 0.18, 900);
      tone(900, 0.3, "square", 0.1, 100, 0.25);
      break;
    case "phase_open":
      tone(880, 0.12, "sine", 0.1, 1320);
      break;
    case "locked":
      tone(180, 0.12, "square", 0.08, 120);
      break;
    case "combo_hit":
      tone(420, 0.1, "triangle", 0.13, 640);
      break;
    case "combo_break":
      tone(300, 0.25, "sawtooth", 0.1, 140);
      break;
    case "special_fail":
      tone(200, 0.15, "square", 0.08, 150);
      break;
    case "success":
      [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, "triangle", 0.14, undefined, i * 0.12));
      break;
    case "failure":
      [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, "sawtooth", 0.12, undefined, i * 0.15));
      break;
  }
}

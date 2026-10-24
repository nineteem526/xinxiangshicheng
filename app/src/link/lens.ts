import type { Caps } from "./signal";

/** Labels that mean "ultra-wide" on Android Chrome / Samsung / Xiaomi / iOS. */
const WIDE = /ultra|超广|超廣|0\.5|wide-angle|ultrawide/i;
const FRONT = /front|前置|user|facing front/i;
const MAIN_WIDE = /\bwide\b|广角/i;

/**
 * Pick the widest rear lens from a labelled device list. Labels are only filled in after camera
 * permission is granted, so call this after the first getUserMedia. Returns null when no lens can
 * be told apart (then we stay on the browser's default and rely on zoom).
 */
export function pickWideLens(devices: { deviceId: string; label: string }[]): string | null {
  const rear = devices.filter((d) => d.label && !FRONT.test(d.label));
  const ultra = rear.find((d) => WIDE.test(d.label));
  if (ultra) return ultra.deviceId;
  return null;
}

/** Short, readable names for the lens switcher. */
export function lensLabel(label: string, index: number): string {
  if (WIDE.test(label)) return "超广角";
  if (/tele|长焦|2x|3x|5x/i.test(label)) return "长焦";
  if (MAIN_WIDE.test(label) || /back|后置|rear|0$/i.test(label)) return "主摄";
  return `镜头 ${index + 1}`;
}

/** Zoom presets worth offering, clipped to what the phone supports. */
export function zoomPresets(min: number, max: number): number[] {
  const wanted = [0.5, 0.6, 1, 2];
  const out = wanted.filter((z) => z >= min - 1e-6 && z <= max + 1e-6);
  if (!out.includes(min)) out.unshift(Number(min.toFixed(2)));
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

export function emptyCaps(): Caps {
  return { zoom: null, value: null, lenses: [], lensId: null };
}

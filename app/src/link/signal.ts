/** WebSocket path -> ws(s) URL on the current origin (works through the Vite proxy). */
export function wsUrl(path: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${path}`;
}

export interface ZoomCaps {
  min: number;
  max: number;
  step: number;
}
export interface LensInfo {
  id: string;
  label: string;
}
/** What the phone's browser lets us control. Sent phone -> PC. */
export interface Caps {
  zoom: ZoomCaps | null;
  value: number | null;
  lenses: LensInfo[];
  lensId: string | null;
}

/** The only message shapes the link ever sends or accepts. Mirrors server/signaling.py. */
export type SignalMsg =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "ice"; candidate: RTCIceCandidateInit | null }
  | { type: "meta"; facing: "user" | "environment" }
  | ({ type: "caps" } & Caps)
  | { type: "set"; zoom?: number; lens?: string };

export type HostEvent = { type: "room"; code: string } | { type: "joined" } | { type: "left" };

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function parseSignal(raw: unknown): SignalMsg | HostEvent | null {
  if (typeof raw !== "string" || raw.length > 64 * 1024) return null;
  let d: unknown;
  try {
    d = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  switch (o.type) {
    case "offer":
    case "answer":
      return typeof o.sdp === "string" && o.sdp ? { type: o.type, sdp: o.sdp } : null;
    case "ice":
      if (o.candidate === null) return { type: "ice", candidate: null };
      if (o.candidate && typeof o.candidate === "object" && typeof (o.candidate as Record<string, unknown>).candidate === "string")
        return { type: "ice", candidate: o.candidate as RTCIceCandidateInit };
      return null;
    case "meta":
      return o.facing === "user" || o.facing === "environment" ? { type: "meta", facing: o.facing } : null;
    case "caps": {
      const z = o.zoom as Record<string, unknown> | null | undefined;
      let zoom: ZoomCaps | null = null;
      if (z) {
        if (typeof z !== "object" || !num(z.min) || !num(z.max) || !num(z.step)) return null;
        zoom = { min: z.min, max: z.max, step: z.step };
      }
      if (!Array.isArray(o.lenses) || o.lenses.length > 8) return null;
      const lenses: LensInfo[] = [];
      for (const l of o.lenses) {
        const r = l as Record<string, unknown>;
        if (!r || typeof r.id !== "string" || typeof r.label !== "string") return null;
        lenses.push({ id: r.id, label: r.label });
      }
      return {
        type: "caps",
        zoom,
        value: num(o.value) ? o.value : null,
        lenses,
        lensId: typeof o.lensId === "string" ? o.lensId : null,
      };
    }
    case "set": {
      const out: { type: "set"; zoom?: number; lens?: string } = { type: "set" };
      if (o.zoom !== undefined) {
        if (!num(o.zoom) || o.zoom < 0.1 || o.zoom > 20) return null;
        out.zoom = o.zoom;
      }
      if (o.lens !== undefined) {
        if (typeof o.lens !== "string" || !o.lens || o.lens.length > 256) return null;
        out.lens = o.lens;
      }
      return out.zoom === undefined && out.lens === undefined ? null : out;
    }
    case "room":
      return typeof o.code === "string" && /^\d{6}$/.test(o.code) ? { type: "room", code: o.code } : null;
    case "joined":
    case "left":
      return { type: o.type };
    default:
      return null;
  }
}

/** LAN peers need no STUN/TURN; leaving iceServers empty keeps everything on the local network. */
export const RTC_CONFIG: RTCConfiguration = { iceServers: [] };

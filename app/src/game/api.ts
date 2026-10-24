import { isTrait } from "./traits";
import { ACCENTS, GESTURES, type Level, type Rift } from "./types";

export type LevelResult = { ok: true; level: Level } | { ok: false; error: string };

const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length >= 1 && v.length <= max && !/[<>{}`]/.test(v);

function parseRift(x: unknown): Rift | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (!isStr(o.object, 12) || !isStr(o.fantasyName, 14)) return null;
  if (!(GESTURES as readonly unknown[]).includes(o.weakness)) return null;
  const b = o.box;
  if (!Array.isArray(b) || b.length !== 4 || !b.every((v) => Number.isInteger(v) && v >= 0 && v <= 1000)) return null;
  const [ymin, xmin, ymax, xmax] = b as number[];
  if (ymax - ymin < 30 || xmax - xmin < 30) return null;
  // A missing trait means plain; a present but unknown one is rejected, never silently downgraded.
  if (o.trait !== undefined && !isTrait(o.trait)) return null;
  return {
    object: o.object,
    fantasyName: o.fantasyName,
    weakness: o.weakness as Rift["weakness"],
    ...(o.trait !== undefined ? { trait: o.trait } : {}),
    box: [ymin, xmin, ymax, xmax],
  };
}

/** Second line of defence: re-validate server output before it can reach the engine. */
export function parseLevel(x: unknown): Level | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const l = o.lines as Record<string, unknown> | undefined;
  if (!l || typeof l !== "object") return null;
  if (!isStr(o.object, 12) || !isStr(o.fantasyName, 14) || !isStr(o.theme, 12) || !isStr(o.mission, 40) || !isStr(o.story, 120)) return null;
  if (!isStr(l.start, 40) || !isStr(l.success, 40) || !isStr(l.failure, 40)) return null;
  if (typeof o.duration !== "number" || !Number.isInteger(o.duration) || o.duration < 30 || o.duration > 90) return null;
  if (o.difficulty !== 1 && o.difficulty !== 2 && o.difficulty !== 3) return null;
  if (!(GESTURES as readonly unknown[]).includes(o.weakness)) return null;
  if (!(ACCENTS as readonly unknown[]).includes(o.accent)) return null;
  if (o.source !== "ai" && o.source !== "manual") return null;
  let rifts: Rift[] | undefined;
  if (o.rifts !== undefined) {
    if (!Array.isArray(o.rifts) || o.rifts.length < 1 || o.rifts.length > 4) return null;
    const parsed = o.rifts.map(parseRift);
    if (parsed.some((r) => !r)) return null;
    rifts = parsed as Rift[];
  }
  return {
    object: o.object,
    fantasyName: o.fantasyName,
    theme: o.theme,
    mission: o.mission,
    story: o.story,
    duration: o.duration,
    difficulty: o.difficulty,
    weakness: o.weakness as Level["weakness"],
    accent: o.accent as string,
    lines: { start: l.start, success: l.success, failure: l.failure },
    source: o.source,
    ...(rifts ? { rifts } : {}),
  };
}

export function requestLevel(body: { image?: string; object?: string }, timeoutMs = 35000): Promise<LevelResult> {
  return post("/api/level", body, timeoutMs);
}

/** Whole-table scan → level with rifts anchored to real objects. */
export function requestScene(image: string, timeoutMs = 40000): Promise<LevelResult> {
  return post("/api/scene", { image }, timeoutMs);
}

async function post(path: string, body: unknown, timeoutMs: number): Promise<LevelResult> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!r.ok) return { ok: false, error: `后端错误 ${r.status}` };
    const data = (await r.json()) as { ok?: boolean; level?: unknown; error?: string };
    if (!data.ok) return { ok: false, error: data.error ?? "生成失败" };
    const level = parseLevel(data.level);
    return level ? { ok: true, level } : { ok: false, error: "返回数据未通过前端校验" };
  } catch (e) {
    return { ok: false, error: (e as Error).name === "AbortError" ? "请求超时" : "无法连接后端(是否已启动 server?)" };
  } finally {
    clearTimeout(timer);
  }
}

/** Grab the current video frame as a downscaled JPEG data URL. Only called on explicit user action. */
export function captureFrame(video: HTMLVideoElement, maxW = 640): string | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const scale = Math.min(1, maxW / video.videoWidth);
  const c = document.createElement("canvas");
  c.width = Math.round(video.videoWidth * scale);
  c.height = Math.round(video.videoHeight * scale);
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.7);
}

/**
 * Canvas-2D "reality shatter": copies the live video region under a rift, cuts it into shards
 * and flings them outward, revealing the accent-coloured void beneath. No WebGL, no 3D.
 */
export interface Shard {
  sx: number; sy: number; sw: number; sh: number; // source rect in the snapshot
  x: number; y: number; vx: number; vy: number; rot: number; vr: number; life: number;
}

export interface Shatter {
  snap: HTMLCanvasElement;
  cx: number; cy: number; // screen centre
  shards: Shard[];
  born: number;
  color: string;
  ttl: number;
}

export function makeShatter(
  video: HTMLVideoElement,
  rect: { x: number; y: number; w: number; h: number }, // screen rect (mirrored coords)
  srcRect: { x: number; y: number; w: number; h: number }, // normalized video rect (un-mirrored)
  color: string,
  now: number,
  strength = 1,
  mirrored = true,
): Shatter | null {
  if (!video.videoWidth) return null;
  const snap = document.createElement("canvas");
  snap.width = Math.max(1, Math.round(rect.w));
  snap.height = Math.max(1, Math.round(rect.h));
  const ctx = snap.getContext("2d");
  if (!ctx) return null;
  // Mirror so the snapshot matches what the player sees on screen.
  if (mirrored) {
    ctx.translate(snap.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(
    video,
    srcRect.x * video.videoWidth, srcRect.y * video.videoHeight, srcRect.w * video.videoWidth, srcRect.h * video.videoHeight,
    0, 0, snap.width, snap.height,
  );
  const cols = 5;
  const rows = 4;
  const sw = snap.width / cols;
  const sh = snap.height / rows;
  const shards: Shard[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = rect.x + c * sw + sw / 2;
      const py = rect.y + r * sh + sh / 2;
      const dx = px - (rect.x + rect.w / 2);
      const dy = py - (rect.y + rect.h / 2);
      const mag = Math.hypot(dx, dy) || 1;
      const speed = (180 + Math.random() * 220) * strength;
      shards.push({
        sx: c * sw, sy: r * sh, sw, sh,
        x: px, y: py,
        vx: (dx / mag) * speed + (Math.random() - 0.5) * 80,
        vy: (dy / mag) * speed - 120 * strength,
        rot: 0, vr: (Math.random() - 0.5) * 8, life: 1,
      });
    }
  }
  return { snap, cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, shards, born: now, color, ttl: 900 };
}

/** Advance and draw. Returns false when the effect has expired. */
export function drawShatter(ctx: CanvasRenderingContext2D, s: Shatter, now: number, dt: number): boolean {
  const t = (now - s.born) / s.ttl;
  if (t >= 1) return false;
  const g = 900; // px/s²
  ctx.save();
  // Void glow where reality broke.
  const rad = 40 + t * 160;
  const grad = ctx.createRadialGradient(s.cx, s.cy, 0, s.cx, s.cy, rad);
  grad.addColorStop(0, s.color);
  grad.addColorStop(1, "transparent");
  ctx.globalAlpha = (1 - t) * 0.9;
  ctx.fillStyle = grad;
  ctx.fillRect(s.cx - rad, s.cy - rad, rad * 2, rad * 2);
  for (const sh of s.shards) {
    sh.vy += g * dt;
    sh.x += sh.vx * dt;
    sh.y += sh.vy * dt;
    sh.rot += sh.vr * dt;
    ctx.globalAlpha = 1 - t * t;
    ctx.translate(sh.x, sh.y);
    ctx.rotate(sh.rot);
    ctx.drawImage(s.snap, sh.sx, sh.sy, sh.sw, sh.sh, -sh.sw / 2, -sh.sh / 2, sh.sw, sh.sh);
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1;
    ctx.strokeRect(-sh.sw / 2, -sh.sh / 2, sh.sw, sh.sh);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  ctx.restore();
  return true;
}

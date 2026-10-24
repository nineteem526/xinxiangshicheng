import { zoomPresets } from "./lens";
import type { Caps } from "./signal";

interface Props {
  caps: Caps;
  onZoom: (z: number) => void;
  onLens: (id: string) => void;
}

/** Zoom presets, a fine slider and a lens switcher for the phone camera. Shown while the phone is live. */
export function LensBar({ caps, onZoom, onLens }: Props) {
  const z = caps.zoom;
  const value = caps.value ?? z?.min ?? 1;
  const hasLenses = caps.lenses.length > 1;
  if (!z && !hasLenses) {
    return <p className="lens-none">这部手机的浏览器不开放倍率和镜头控制。请在手机上换成 Chrome,或把手机离桌面远一点。</p>;
  }
  return (
    <div className="lens" role="group" aria-label="手机画面倍率和镜头">
      {z && (
        <>
          <div className="lens-row">
            {zoomPresets(z.min, z.max).map((p) => (
              <button key={p} aria-pressed={Math.abs(value - p) < 0.06} onClick={() => onZoom(p)}>
                {p}x
              </button>
            ))}
          </div>
          <input
            type="range"
            min={z.min}
            max={Math.min(z.max, 4)}
            step={Math.max(z.step, 0.05)}
            value={Math.min(value, Math.min(z.max, 4))}
            aria-label="画面倍率"
            onChange={(e) => onZoom(Number(e.target.value))}
          />
          <div className="lens-val">
            {value.toFixed(1)}x
            <span>{value <= z.min + 0.06 ? "已是最广" : ""}</span>
          </div>
        </>
      )}
      {hasLenses && (
        <div className="lens-row" role="radiogroup" aria-label="镜头">
          {caps.lenses.map((l) => (
            <button key={l.id} role="radio" aria-checked={l.id === caps.lensId} onClick={() => onLens(l.id)}>
              {l.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

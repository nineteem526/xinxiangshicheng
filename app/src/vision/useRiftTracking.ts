import { useEffect, useRef, type RefObject } from "react";
import { handOver, riftRect, type NRect } from "../game/rifts";
import type { Rift } from "../game/types";
import { grabGray, RiftTracker, type Gray } from "./tracker";
import type { HandPos } from "./useGestures";

/**
 * Keeps each rift glued to its real object. `seed` is the grayscale frame captured at the instant of
 * the scan, so the model's boxes line up with it even if the camera moved while the model was thinking.
 * Results live in refs (no re-render per frame); without a seed it falls back to the model's static boxes.
 */
export function useRiftTracking(
  videoRef: RefObject<HTMLVideoElement | null>,
  handRef: RefObject<HandPos>,
  rifts: Rift[] | undefined,
  seed: Gray | null,
  active: boolean,
) {
  const rects = useRef<NRect[]>([]);
  const lost = useRef<boolean[]>([]);
  const tracker = useRef<RiftTracker | null>(null);

  useEffect(() => {
    rects.current = (rifts ?? []).map(riftRect);
    lost.current = (rifts ?? []).map(() => false);
    tracker.current = rifts?.length && seed ? new RiftTracker(seed, rects.current) : null;
  }, [rifts, seed]);

  useEffect(() => {
    if (!active || !rifts?.length) return;
    const id = setInterval(() => {
      const t = tracker.current;
      const v = videoRef.current;
      if (!t || !v) return;
      const g = grabGray(v);
      if (!g) return;
      const hand = handRef.current;
      t.update(g, t.rects().map((r) => handOver(r, hand)));
      rects.current = t.rects();
      lost.current = t.lost();
    }, 80);
    return () => clearInterval(id);
  }, [active, rifts, videoRef, handRef]);

  return { rects, lost };
}

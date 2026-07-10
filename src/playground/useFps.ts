import { useEffect, useRef, useState } from "react";

export interface FpsSample {
  /** Frames counted in the trailing 1s ≈ current FPS. */
  fps: number;
  /** Worst (lowest) instantaneous FPS in a rolling 3s window — the number that matters. */
  minFps: number;
  /** Duration of the last frame, ms. */
  frameMs: number;
}

/**
 * Measures real frame rate via requestAnimationFrame. Emits at ~4 Hz to avoid the meter
 * itself causing re-render churn — keep this hook inside a leaf component (PerfOverlay), not
 * in a parent that renders the grid (DECISIONS.md D1: hot paths stay out of React render).
 */
export function useFps(): FpsSample {
  const [sample, setSample] = useState<FpsSample>({
    fps: 0,
    minFps: 0,
    frameMs: 0,
  });

  const frameTimes = useRef<number[]>([]);
  const last = useRef(0);
  const min = useRef(Infinity);
  const minWindowStart = useRef(0);
  const lastEmit = useRef(0);
  const rafId = useRef(0);

  useEffect(() => {
    const tick = (t: number) => {
      const prev = last.current;
      last.current = t;

      if (prev) {
        const dt = t - prev;

        // trailing-1s frame count → FPS
        frameTimes.current.push(t);
        const cutoff = t - 1000;
        while (frameTimes.current.length && frameTimes.current[0] < cutoff) {
          frameTimes.current.shift();
        }
        const fps = frameTimes.current.length;

        // rolling 3s minimum of instantaneous FPS (captures the worst frame)
        const inst = dt > 0 ? 1000 / dt : 0;
        if (t - minWindowStart.current > 3000) {
          min.current = inst;
          minWindowStart.current = t;
        } else {
          min.current = Math.min(min.current, inst);
        }

        if (t - lastEmit.current > 250) {
          lastEmit.current = t;
          setSample({
            fps,
            minFps: Math.round(min.current),
            frameMs: Math.round(dt * 10) / 10,
          });
        }
      }

      rafId.current = requestAnimationFrame(tick);
    };

    rafId.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId.current);
  }, []);

  return sample;
}

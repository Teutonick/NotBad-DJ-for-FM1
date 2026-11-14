import { useEffect, useRef } from "react";

// Aplica el tempo del deck (pitch + bend, en %) al playbackRate del <audio>.
//
// Arrastrar el fader genera decenas de cambios por segundo: escribir
// playbackRate en cada uno (y peor, mantener una rampa por rAF viva) provoca
// microcortes en el audio. Aquí se agrupa en un solo write por frame y solo
// se rampa cuando el salto es grande (SYNC, reset...).
const RAMP_MS = 120;
const BIG_JUMP = 0.01; // 1 % de tempo

export function usePlaybackRate(audioRef, tempoPct) {
  const targetRef = useRef(1);
  const rafRef = useRef(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const target = 1 + tempoPct / 100;
    targetRef.current = target;

    // Salto pequeño (arrastre normal): un único write, agrupado por frame
    if (Math.abs(target - el.playbackRate) < BIG_JUMP) {
      if (rafRef.current) return; // ya hay un write programado
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const elNow = audioRef.current;
        if (!elNow) return;
        const want = targetRef.current;
        // ignorar cambios inaudibles (< 0.02 %)
        if (Math.abs(want - elNow.playbackRate) > 0.0002) {
          elNow.playbackRate = want;
        }
      });
      return;
    }

    // Salto grande: rampa suave
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const startRate = el.playbackRate || 1;
    const start = performance.now();
    const step = (now) => {
      const k0 = Math.min(1, (now - start) / RAMP_MS);
      const k = k0 < 0.5 ? 2 * k0 * k0 : -1 + (4 - 2 * k0) * k0;
      el.playbackRate = startRate + (targetRef.current - startRate) * k;
      if (k0 < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null;
        el.playbackRate = targetRef.current;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [audioRef, tempoPct]);
}

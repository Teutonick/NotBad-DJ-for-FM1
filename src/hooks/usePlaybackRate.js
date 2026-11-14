import { useEffect, useRef } from "react";

// Aplica el tempo del deck (pitch + bend, en %) al playbackRate del <audio>.
//
// Arrastrar el fader genera decenas de cambios por segundo: escribir
// playbackRate en cada uno (y peor, mantener una rampa por rAF viva) provoca
// microcortes en el audio. Aquí se agrupa en un solo write por frame y solo
// se rampa cuando el salto es grande (SYNC, reset...).
const RAMP_MS = 120;
const BIG_JUMP = 0.01; // 1 % de tempo
const INAUDIBLE = 0.0002; // 0,02 %
// Lo que se ignore por inaudible se escribe EXACTO cuando el tempo lleva este
// rato quieto: si no, el último paso de la rampa del bend (o de un arrastre)
// dejaba el deck hasta un 0,02 % desviado, ~12 ms por minuto de deriva
// contra el otro. Mientras se mueve no añade escrituras.
const SETTLE_MS = 150;

export function usePlaybackRate(audioRef, tempoPct) {
  const targetRef = useRef(1);
  const rafRef = useRef(null);
  const settleRef = useRef(null);

  useEffect(() => () => clearTimeout(settleRef.current), []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const target = 1 + tempoPct / 100;
    targetRef.current = target;
    clearTimeout(settleRef.current);

    // Salto pequeño (arrastre normal): un único write, agrupado por frame
    if (Math.abs(target - el.playbackRate) < BIG_JUMP) {
      if (rafRef.current) return; // ya hay un write programado
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const elNow = audioRef.current;
        if (!elNow) return;
        const want = targetRef.current;
        // ignorar cambios inaudibles (< 0.02 %)... hasta que se quede quieto
        if (Math.abs(want - elNow.playbackRate) > INAUDIBLE) {
          elNow.playbackRate = want;
        } else if (want !== elNow.playbackRate) {
          settleRef.current = setTimeout(() => {
            const elLast = audioRef.current;
            if (elLast && elLast.playbackRate !== targetRef.current) {
              elLast.playbackRate = targetRef.current;
            }
          }, SETTLE_MS);
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

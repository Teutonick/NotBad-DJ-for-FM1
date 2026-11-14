import { useRef, useState } from "react";

// Bend: estirón momentáneo del tempo, en %, encima del pitch.
//
// - startBend(±1): mientras se mantiene pulsado, ±bendRange (de ⚙; sin él,
//   2 %: en makina un 2 % ya es mucho).
// - releaseBend(): vuelve a 0 con una rampa corta.
// - nudge(pct): el arrastre de la onda en play. Es un gesto continuo y da más
//   margen que los botones (hasta 3 × bendRange), pero sigue atado al ajuste.
const RELEASE_MS = 120;

export function useBend(bendRange) {
  const [bendPct, setBendPct] = useState(0);
  const holdRef = useRef(false);
  const rafRef = useRef(null);
  const max = bendRange > 0 ? bendRange : 2;

  const startBend = (sign) => {
    holdRef.current = true;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setBendPct(sign * max);
  };

  const releaseBend = () => {
    holdRef.current = false;
    const start = performance.now();
    const startVal = bendPct;

    const step = (now) => {
      const p = Math.min(1, (now - start) / RELEASE_MS);
      setBendPct(startVal * (1 - p));
      if (p < 1 && !holdRef.current) {
        rafRef.current = requestAnimationFrame(step);
      } else if (!holdRef.current) {
        setBendPct(0);
      }
    };
    rafRef.current = requestAnimationFrame(step);
  };

  const nudge = (pct) => {
    const tope = max * 3;
    holdRef.current = true;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setBendPct(Math.max(-tope, Math.min(tope, pct)));
  };

  return { bendPct, startBend, releaseBend, nudge };
}

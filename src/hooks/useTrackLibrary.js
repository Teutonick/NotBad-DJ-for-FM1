import { useCallback, useEffect, useRef, useState } from "react";
import { quickAnalyzeTrack } from "../audio/analyzeTrack";
import { readTrackMetadata } from "../audio/metadata";
import {
  loadStoredTracks,
  mergeTrackAnalysis,
  removeStoredTrack,
  storeTrack,
} from "../lib/trackStore";
import {
  newTrackFromFile,
  nextPendingAnalysis,
  nextPendingTags,
  withTags,
} from "../lib/trackRules";
import { ERRORS, logError } from "../lib/log";

// === Lista de canciones (crate) con su persistencia en IndexedDB ===
//
// - Al arrancar trae lo guardado.
// - `updateTrack(id, fn)`: el ÚNICO camino para cambiar una pista. `fn` recibe
//   la pista y devuelve la nueva, o la MISMA si no cambia nada (las reglas de
//   src/lib/trackRules.js ya lo hacen así); solo se escribe en IndexedDB si es
//   otra. Con `{ persist: false }` el cambio se queda en memoria.
// - Dos colas en segundo plano, de una pista en una y solo en modo de análisis
//   "auto": las etiquetas (casi instantáneas, no hay que decodificar) y el
//   BPM + tonalidad (decode completo; espera 5 s y a que el navegador esté
//   libre para no laguear).
//
// Las colas usan un ref de "ocupada" que se suelta en el `finally` de la
// promesa. Funciona porque ese `finally` (una microtarea) corre antes del
// render que provoca el setTracks del resultado, así que cuando el efecto
// vuelve a mirar la lista la cola ya está libre. Si se cambia el orden (p. ej.
// soltar el ref en otro sitio), la cola se puede quedar parada.
export function useTrackLibrary({ analysisMode }) {
  const [tracks, setTracks] = useState([]);
  const analysisBusyRef = useRef(false);
  const metaBusyRef = useRef(false);

  const updateTrack = useCallback((id, fn, { persist = true } = {}) => {
    setTracks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const updated = fn(t);
        if (persist && updated !== t) storeTrack(updated);
        return updated;
      }),
    );
  }, []);

  const addTracks = useCallback((files) => {
    setTracks((prev) => {
      const next = [...prev];
      for (const file of files) {
        const exists = next.some(
          (t) => t.name === file.name && t.size === file.size,
        );
        if (!exists) {
          const track = newTrackFromFile(file);
          next.push(track);
          storeTrack(track);
        }
      }
      return next;
    });
  }, []);

  const removeTrack = useCallback((id) => {
    setTracks((prev) => prev.filter((t) => t.id !== id));
    removeStoredTrack(id);
  }, []);

  // Cargar la lista guardada al arrancar
  useEffect(() => {
    let cancelled = false;
    loadStoredTracks().then((stored) => {
      if (!cancelled && stored.length) {
        setTracks((prev) => {
          const known = new Set(prev.map((t) => t.id));
          return [...prev, ...stored.filter((t) => !known.has(t.id))];
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // BPM + tonalidad en segundo plano
  useEffect(() => {
    if (analysisMode !== "auto") return;
    if (analysisBusyRef.current) return;
    const pending = nextPendingAnalysis(tracks);
    if (!pending) return;

    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      analysisBusyRef.current = true;
      quickAnalyzeTrack(pending.file)
        .then(({ bpm, gridAnchor, duration, musicalKey }) => {
          // Un ajuste manual de rejilla nunca lo pisa el análisis de fondo
          updateTrack(pending.id, (t) =>
            mergeTrackAnalysis(t, { bpm, gridAnchor, duration, musicalKey }),
          );
        })
        .catch((err) => {
          logError(ERRORS.ANALYSIS_LIST, err, { track: pending.name });
          // Solo en memoria: al recargar se reintenta
          updateTrack(pending.id, (t) => ({ ...t, analyzeFailed: true }), {
            persist: false,
          });
        })
        .finally(() => {
          analysisBusyRef.current = false;
        });
    };

    const timerId = setTimeout(() => {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(run, { timeout: 15000 });
      } else {
        run();
      }
    }, 5000);

    return () => {
      cancelled = true;
      clearTimeout(timerId);
    };
  }, [tracks, analysisMode, updateTrack]);

  // Etiquetas ID3 + miniatura de carátula
  useEffect(() => {
    if (analysisMode !== "auto") return;
    if (metaBusyRef.current) return;
    const pending = nextPendingTags(tracks);
    if (!pending) return;

    metaBusyRef.current = true;
    readTrackMetadata(pending.file)
      .then((meta) => updateTrack(pending.id, (t) => withTags(t, meta)))
      .finally(() => {
        metaBusyRef.current = false;
      });
  }, [tracks, analysisMode, updateTrack]);

  return { tracks, updateTrack, addTracks, removeTrack };
}

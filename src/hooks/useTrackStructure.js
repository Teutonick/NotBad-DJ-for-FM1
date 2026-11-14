import { useEffect, useMemo, useRef, useState } from "react";
import {
  alignStructure,
  detectStructure,
  refitPhrase,
  shiftPhraseOffset,
} from "../audio/structure";

// === Estructura de la pista de un deck (tramos con y sin ritmo + frase) ===
//
// Los tramos se guardan en SEGUNDOS y los índices de beat se recalculan
// contra la rejilla actual (`gridStructure`): así un ajuste manual de rejilla
// no descuadra la cuenta atrás.
//
// - Se detecta UNA vez por pista, cuando ya hay onda y rejilla, y nunca si la
//   pista traía su estructura guardada (`restore`).
// - OJO con la duración: tiene que ser la del BUFFER que produjo `bandLow`,
//   no la del <audio>. La cadencia de los graves se deduce de
//   bandLow.length / duración; con la del <audio> —que en FLAC no coincide al
//   milímetro— el mapeo de beat a muestra deriva y los tramos se mueven.
// - Cambiar el tamaño de frase recoloca la retícula sin volver a analizar.
// - Lo ajustado a mano (`manual`) no lo pisa ningún análisis.
// - Cada cambio sube al padre con `onStructure(side, structure)`, que lo
//   refleja en la lista y lo persiste.
export function useTrackStructure({
  bandLow,
  beats,
  bufferDuration,
  phraseSize,
  objectUrl,
  side,
  onStructure,
}) {
  const [structure, setStructure] = useState(null);
  // ¿La pista cargada traía su estructura guardada? Entonces no se detecta.
  const cachedRef = useRef(false);

  const gridStructure = useMemo(
    () => (structure ? alignStructure(structure, beats) : null),
    [structure, beats]
  );

  // Detección: una vez por pista, cuando ya hay onda y rejilla
  useEffect(() => {
    if (structure || cachedRef.current) return;
    if (!bandLow?.length || !beats.length || !(bufferDuration > 0)) return;
    const found = detectStructure({
      bandLow,
      duration: bufferDuration,
      beats,
      phraseSize,
    });
    if (found) setStructure(found);
  }, [structure, bandLow, beats, bufferDuration, phraseSize]);

  // Cambiar el tamaño de frase (aquí o en ⚙: es el mismo ajuste) recoloca la
  // retícula. Depende también de la estructura: una guardada con otro tamaño
  // (se analizó con 16 y ⚙ dice ahora 8) se recoloca al cargarla. refitPhrase
  // devuelve el MISMO objeto cuando el tamaño ya cuadra: no entra en bucle.
  useEffect(() => {
    setStructure((prev) => (prev ? refitPhrase(prev, phraseSize) : prev));
  }, [phraseSize, structure]);

  // La estructura sube al padre, que la refleja en la lista y la persiste
  const onStructureRef = useRef(onStructure);
  onStructureRef.current = onStructure;
  useEffect(() => {
    if (!objectUrl || !structure) return;
    onStructureRef.current?.(side, structure);
  }, [structure, objectUrl, side]);

  // Al cargar una pista: su estructura guardada (ya saneada) o null. Con una
  // guardada, el análisis no la vuelve a calcular ni pisa el ajuste de frase.
  const restore = (saved) => {
    cachedRef.current = Boolean(saved);
    setStructure(saved);
  };

  // Mueve la frase n kicks. Queda marcado como manual: el análisis ya no lo pisa.
  const shiftPhrase = (delta) => {
    setStructure((prev) =>
      prev
        ? {
            ...prev,
            phraseOffset: shiftPhraseOffset(prev.phraseOffset, delta, prev.phraseSize),
            manual: true,
          }
        : prev
    );
  };

  // Vuelve al desplazamiento que dijo el análisis
  const resetPhrase = () => {
    setStructure((prev) =>
      prev ? { ...prev, phraseOffset: prev.detectedOffset, manual: false } : prev
    );
  };

  // Relanza la detección sobre la rejilla ACTUAL (la que haya ajustado el
  // usuario). Un desplazamiento de frase puesto a mano se conserva.
  const redetectStructure = () => {
    if (!bandLow?.length || !beats.length || !(bufferDuration > 0)) return;
    const found = detectStructure({
      bandLow,
      duration: bufferDuration,
      beats,
      phraseSize,
    });
    if (!found) return;
    setStructure((prev) =>
      prev?.manual ? { ...found, phraseOffset: prev.phraseOffset, manual: true } : found
    );
  };

  return {
    structure,
    gridStructure,
    restore,
    shiftPhrase,
    resetPhrase,
    redetectStructure,
  };
}

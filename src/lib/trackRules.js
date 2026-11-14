// Reglas de cómo cambia una pista de la lista (crate) con cada dato que llega:
// del deck (rejilla, etiquetas, cues, estructura, que se ha pinchado) o de las
// colas de análisis en segundo plano.
//
// Todas son puras y devuelven LA MISMA pista cuando no cambia nada: quien las
// usa (useTrackLibrary.updateTrack) solo escribe en IndexedDB si la pista es
// otra. Lo del usuario (rejilla manual, cues, loops, estructura ajustada) no lo
// pisa ningún análisis: ver también mergeTrackAnalysis en trackStore.js.

import { sameCueData, sanitizeHotCues, sanitizeLoopRegion, sanitizeSavedLoops } from "./cuePoints";

/** Fila nueva de la lista para un File, con todo por analizar. */
export function newTrackFromFile(file) {
  return {
    id: `${file.name}-${file.size}-${file.lastModified}`,
    name: file.name,
    size: file.size,
    file,
    bpm: null,
    gridAnchor: null,
    gridManual: false,
    duration: null,
    playedOn: {},
    analyzed: false,
    artist: null,
    title: null,
    album: null,
    artwork: null,
    metaRead: false,
    musicalKey: null,
  };
}

/**
 * Rejilla del deck (detectada o ajustada a mano). La duración es la del
 * <audio>; si no vale, se queda la que había.
 */
export function withGrid(track, { bpm, anchor, manual, duration }) {
  if (
    track.bpm === bpm &&
    track.gridAnchor === anchor &&
    Boolean(track.gridManual) === manual &&
    track.duration != null
  ) {
    return track;
  }
  return {
    ...track,
    bpm,
    gridAnchor: anchor,
    gridManual: manual,
    duration: Number.isFinite(duration) && duration > 0 ? duration : track.duration,
  };
}

/**
 * Lo que lee el deck al cargar: la tonalidad solo si la pista no tenía, y las
 * etiquetas solo si aún no se habían leído.
 */
export function withDeckMeta(track, data) {
  const updated = { ...track };
  let changed = false;
  if (data.musicalKey && !track.musicalKey) {
    updated.musicalKey = data.musicalKey;
    changed = true;
  }
  if ("artist" in data && !track.metaRead) {
    updated.artist = data.artist;
    updated.title = data.title;
    updated.album = data.album;
    updated.artwork = data.artwork;
    updated.metaRead = true;
    changed = true;
  }
  return changed ? updated : track;
}

/**
 * Hot cues y loops: son del USUARIO y se guardan tal cual, saneados.
 * `activeLoop: undefined` = no toques el loop guardado (pasa durante un loop
 * roll, que es momentáneo y no debe pisar el loop de la pista).
 */
export function withCues(track, data) {
  const hotCues = sanitizeHotCues(data.hotCues);
  const savedLoops = sanitizeSavedLoops(data.savedLoops);
  const activeLoop =
    data.activeLoop === undefined
      ? track.activeLoop ?? null
      : sanitizeLoopRegion(data.activeLoop);
  if (
    sameCueData(track.hotCues, hotCues) &&
    sameCueData(track.savedLoops, savedLoops) &&
    sameCueData(track.activeLoop ?? null, activeLoop)
  ) {
    return track;
  }
  return { ...track, hotCues, savedLoops, activeLoop };
}

/**
 * ¿Ha cambiado algo de la estructura que merezca escribir en IndexedDB? Los
 * tramos se comparan por sus límites: son los mismos números que se
 * guardaron, no hay redondeos de por medio.
 */
export function sameStructure(a, b) {
  if (!a || !b) return a === b;
  if (
    a.phraseSize !== b.phraseSize ||
    a.phraseOffset !== b.phraseOffset ||
    a.detectedOffset !== b.detectedOffset ||
    Boolean(a.manual) !== Boolean(b.manual) ||
    Boolean(a.confident) !== Boolean(b.confident) ||
    a.sections?.length !== b.sections?.length
  ) {
    return false;
  }
  return a.sections.every(
    (s, i) =>
      s.start === b.sections[i].start &&
      s.end === b.sections[i].end &&
      Boolean(s.kick) === Boolean(b.sections[i].kick)
  );
}

/** Estructura (ya saneada) analizada o ajustada en el deck. */
export function withStructure(track, structure) {
  return sameStructure(track.structure, structure) ? track : { ...track, structure };
}

/** Marca que la pista ya se pinchó en ese deck. */
export function withPlayed(track, side) {
  if (track.playedOn?.[side]) return track;
  return { ...track, playedOn: { ...(track.playedOn || {}), [side]: true } };
}

/** Etiquetas leídas en segundo plano. */
export function withTags(track, meta) {
  return { ...track, ...meta, metaRead: true };
}

/**
 * Siguiente pista para el análisis de fondo (BPM + tonalidad). `analyzed`
 * evita rehacer el trabajo en bucle cuando una pista no da tonalidad (p. ej.
 * percusión pura); `analyzeFailed` vive solo en memoria y se reintenta al
 * recargar.
 */
export function nextPendingAnalysis(tracks) {
  return tracks.find(
    (t) => !t.analyzed && (t.bpm == null || t.musicalKey == null) && !t.analyzeFailed
  );
}

/** Siguiente pista a la que leerle las etiquetas en segundo plano. */
export function nextPendingTags(tracks) {
  return tracks.find((t) => !t.metaRead);
}

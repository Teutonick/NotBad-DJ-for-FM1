import { analyzeTrackDetails } from "../audio/trackDetails";
import { useEffect, useRef, useState } from "react";
import { computeAutoGainDb } from "../audio/utils";
import { computeOnsetEnvelope, detectTempoAsync } from "../audio/beatGrid";
import { detectKey } from "../audio/keyDetect";
import { readTrackMetadata } from "../audio/metadata";
import { ERRORS, logError, logWarn } from "../lib/log";

// Ejecuta algo cuando el navegador esté ocioso (con tope), devolviendo un
// cancelador. Se usa para el análisis de tonalidad, que es síncrono y no debe
// competir con el pintado inicial de la onda.
function deferIdle(fn) {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(fn, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 250);
  return () => clearTimeout(id);
}

// Lo que la lista ya tenga analizado de una pista y se reutiliza tal cual
const cachedFrom = (tr) => ({
  musicalKey: tr.musicalKey,
  artist: tr.artist,
  title: tr.title,
  album: tr.album,
  bpm: tr.bpm,
  gridAnchor: tr.gridAnchor,
  gridManual: tr.gridManual,
  hotCues: tr.hotCues,
  savedLoops: tr.savedLoops,
  activeLoop: tr.activeLoop,
  structure: tr.structure,
  audioDetails: tr.audioDetails,
});

// === Carga de una pista en un deck y su análisis ===
//
// Por aquí pasan TODAS las vías de carga (el botón del deck y la lista), y
// por eso aquí va el bloqueo de carga mientras suena.
//
// - Cada carga lleva un token (`loadIdRef`): lo asíncrono de una pista
//   anterior (etiquetas, rejilla, tonalidad, reanálisis) se descarta si
//   mientras tanto se ha cargado otra.
// - Una sola decodificación: de ese AudioBuffer salen la onda, las bandas,
//   los graves de la estructura, el loudness, la envolvente de onsets y la
//   tonalidad. Nada vuelve a leer el blob que reproduce el <audio> (eso
//   congelaba la reproducción si se pulsaba Play durante el análisis).
// - Lo que es del deck (rejilla, cues, loops, estructura) no vive aquí: se
//   avisa con `events.current`, que el deck rellena en cada render:
//     onReset(cached, { manualGrid })  al empezar, para dejar el deck limpio
//                                      o con lo guardado de ESTA pista
//     onSourceReady({ wasPlaying })    el <audio> ya tiene la pista nueva
//     onAutoCue(time)                  inicio del sonido, y luego primer beat
//     onBeatsDetected(info | null)     BPM y ancla del análisis automático
//     onAnalysis, onAutoGainComputed, onTrackMeta, onLocalLoad: los del padre
export function useTrackLoader({
  engine,
  audioRef,
  side,
  keyLock,
  lockLoadWhilePlaying,
  externalTrack,
  events,
}) {
  const [fileName, setFileName] = useState("");
  const [loadError, setLoadError] = useState("");
  const [objectUrl, setObjectUrl] = useState("");
  const [waveData, setWaveData] = useState(null);
  const [bandIndex, setBandIndex] = useState(null);
  // Energía de graves por muestra: sale de la MISMA pasada que la onda y es
  // de donde salen los kicks del análisis de estructura.
  const [bandLow, setBandLow] = useState(null);
  // Duración según el buffer decodificado: está antes que la del <audio>, y
  // así la rejilla se puede dibujar en cuanto acaba el análisis.
  const [bufferDuration, setBufferDuration] = useState(0);
  const [tags, setTags] = useState(null); // {artist, title, album}
  const [musicalKey, setMusicalKey] = useState(null); // {pitchClass, mode, confidence}
  // Fase de análisis para la UI: null | "wave" | "bpm" | "regrid"
  const [analyzing, setAnalyzing] = useState(null);

  // Envolvente de onsets (~200 KB). Se guarda para reanalizar sobre el ajuste
  // manual sin volver a decodificar.
  const envelopeRef = useRef(null);
  // La pista llegó con una rejilla ajustada a mano: no se sobreescribe
  const cachedGridRef = useRef(false);
  const cachedKeyRef = useRef(null);
  const keyIdleRef = useRef(null);
  const loadIdRef = useRef(0);

  const keyLockRef = useRef(keyLock);
  keyLockRef.current = keyLock;
  const lockLoadRef = useRef(lockLoadWhilePlaying);
  lockLoadRef.current = lockLoadWhilePlaying;

  // limpiar URL de archivo
  useEffect(
    () => () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
    [objectUrl],
  );

  useEffect(() => () => keyIdleRef.current?.(), []);

  // La tonalidad de la pista cargada sube al padre (venga del análisis o de
  // la caché de la lista): la usa la lista para marcar compatibilidades
  useEffect(() => {
    events.current.onTrackMeta?.(side, { musicalKey });
  }, [events, musicalKey, side]);

  // === Detección de BPM y rejilla, sobre el AudioBuffer ya decodificado ===
  async function detectBeats(audioBuffer, loadId) {
    try {
      // La envolvente se calcula siempre, aunque la rejilla venga ajustada a
      // mano: es lo que necesita después el reanálisis guiado.
      const envelope = await computeOnsetEnvelope(audioBuffer);
      if (loadIdRef.current !== loadId) return;
      envelopeRef.current = envelope;

      if (cachedGridRef.current) return; // rejilla manual guardada: no se toca

      const info = envelope ? await detectTempoAsync(envelope) : null;
      if (loadIdRef.current !== loadId) return;
      events.current.onBeatsDetected?.(info?.bpm ? info : null);
    } catch (err) {
      logError(ERRORS.ANALYSIS_BEATS, err, { deck: side });
      if (loadIdRef.current === loadId) events.current.onBeatsDetected?.(null);
    } finally {
      if (loadIdRef.current === loadId) setAnalyzing(null);
    }
  }

  // === Onda + bandas + loudness (una sola pasada por el buffer) ===
  // `name` solo es para el registro: el estado fileName aún puede tener el de
  // la pista anterior cuando esto corre
  async function analyzeTrack(arrayBuffer, loadId, name, cached) {
    const audioBuffer = await engine.ctx.decodeAudioData(arrayBuffer);
    const details =
      cached?.audioDetails || (await analyzeTrackDetails(audioBuffer));
    if (loadIdRef.current !== loadId) return;
    const ev = events.current;

    const duration = audioBuffer.duration;
    setBufferDuration(duration);
    const {
      waveData: norm,
      bandIndex: bands,
      bandLow: low,
      peak,
      loudDb,
    } = details;

    setWaveData(norm);
    setBandIndex(bands);
    setBandLow(low);
    ev.onAnalysis?.(side, { waveData: norm, duration, audioDetails: details });

    // Auto-cue provisional: inicio del sonido (primer bloque no silencioso)
    const onsetIdx = norm.findIndex((v) => v > 0.05);
    if (onsetIdx > -1) ev.onAutoCue?.((onsetIdx / norm.length) * duration);

    // Loudness de TODA la pista, calculado una sola vez al cargarla: nunca se
    // vuelve a mover durante la reproducción
    ev.onAutoGainComputed?.(side, computeAutoGainDb({ loudDb, peak }));

    setAnalyzing("bpm");
    detectBeats(audioBuffer, loadId);

    // Tonalidad: el MISMO AudioBuffer, sin otro decode. Bloquea el hilo
    // principal unos cientos de ms, así que se deja para un hueco libre y
    // solo si la pista no la traía ya analizada.
    if (!cachedKeyRef.current) {
      keyIdleRef.current = deferIdle(() => {
        try {
          const detected = detectKey(audioBuffer);
          if (detected && loadIdRef.current === loadId) setMusicalKey(detected);
        } catch (err) {
          logWarn(ERRORS.ANALYSIS_KEY, err, { deck: side, track: name });
        }
      });
    }
  }

  const loadTrack = (f, cached) => {
    if (!f) return;
    const playingNow = audioRef.current && !audioRef.current.paused;
    if (lockLoadRef.current && playingNow) return;
    keyIdleRef.current?.();
    keyIdleRef.current = null;
    cachedKeyRef.current = cached?.musicalKey || null;
    const loadId = ++loadIdRef.current;

    // Rejilla guardada por el usuario: se restaura tal cual y el análisis
    // automático no la vuelve a pisar.
    const manualGrid = Boolean(
      cached?.gridManual &&
      cached?.bpm > 0 &&
      Number.isFinite(cached?.gridAnchor),
    );
    cachedGridRef.current = manualGrid;
    envelopeRef.current = null;
    setBufferDuration(0);

    setFileName(f.name);
    setLoadError("");
    setWaveData(null);
    setBandIndex(null);
    setBandLow(null);
    setMusicalKey(cached?.musicalKey || null);
    setTags(
      cached?.artist || cached?.title
        ? { artist: cached.artist, title: cached.title, album: cached.album }
        : null,
    );
    events.current.onReset?.(cached, { manualGrid });
    setAnalyzing("wave");
    events.current.onAnalysis?.(side, { waveData: null, duration: 0 });

    // Etiquetas ID3: no dependen del decode, así que se leen en paralelo y
    // aparecen en cuanto están (normalmente antes que la onda)
    if (!cached?.title && !cached?.artist) {
      readTrackMetadata(f).then((meta) => {
        if (loadIdRef.current !== loadId) return; // ya hay otra pista cargada
        if (meta.artist || meta.title) {
          setTags({
            artist: meta.artist,
            title: meta.title,
            album: meta.album,
          });
        }
        events.current.onTrackMeta?.(side, meta);
      });
    }

    (async () => {
      // Copia propia de los bytes: si el mismo archivo se carga en los dos
      // decks, dos <audio> leyendo el MISMO File en streaming se atascan
      // (la reproducción se congela); con una copia por deck no
      const arrayBuffer = await f.arrayBuffer();
      if (loadIdRef.current !== loadId) return;
      const blobCopy = new Blob([arrayBuffer], {
        type: f.type || "audio/mpeg",
      });
      const url = URL.createObjectURL(blobCopy);
      setObjectUrl(url);

      const el = audioRef.current;
      // Cambiar de fuente para el <audio>: si sonaba, el deck tiene que
      // contárselo al padre (que si no lo sigue dando por sonando)
      const wasPlaying = Boolean(el && !el.paused);
      if (el) {
        el.src = url;
        el.load();
        el.preservesPitch = !!keyLockRef.current;
      }
      events.current.onSourceReady?.({ wasPlaying });

      // decodeAudioData "consume" (detach) el arrayBuffer, por eso la copia
      // del blob se hace antes
      await analyzeTrack(arrayBuffer, loadId, f.name, cached);
    })().catch((err) => {
      logError(ERRORS.TRACK_LOAD, err, { deck: side, file: f.name });
      if (loadIdRef.current === loadId) {
        setAnalyzing(null);
        setLoadError(
          `Could not decode ${f.name}. Choose a supported, undamaged audio file.`,
        );
      }
    });
  };

  const loadTrackRef = useRef(loadTrack);
  loadTrackRef.current = loadTrack;

  // Carga desde la lista de canciones (crate)
  const externalTrackRef = useRef(externalTrack);
  externalTrackRef.current = externalTrack;
  useEffect(() => {
    const tr = externalTrackRef.current;
    if (!tr?.file) return;
    loadTrackRef.current(tr.file, cachedFrom(tr));
  }, [externalTrack?.loadToken, externalTrack?.file]);

  // Archivo elegido con el botón del propio deck
  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    // No viene de la lista: el padre suelta el vínculo con la pista que
    // hubiera cargada y no le escribe encima cues, loops ni rejilla de otra.
    events.current.onLocalLoad?.(side);
    loadTrack(f);
    e.target.value = ""; // permite volver a elegir el mismo archivo
  };

  // Reanálisis guiado: busca el mejor encaje ALREDEDOR del BPM y el ancla que
  // ha dejado el usuario, sobre la envolvente ya calculada (ni fetch ni
  // decode). Devuelve { bpm, anchor } o null si no hay nada que aplicar
  // (sin envolvente, ya analizando, fallo u otra pista cargada mientras).
  const regrid = async (seedBpm, seedAnchor) => {
    const envelope = envelopeRef.current;
    if (!envelope || !seedBpm || analyzing) return null;
    const loadId = loadIdRef.current;
    setAnalyzing("regrid");
    try {
      const info = await detectTempoAsync(envelope, {
        seedBpm,
        seedAnchor,
        bpmTolerance: 6,
      });
      if (loadIdRef.current !== loadId) return null;
      return info?.bpm ? info : null;
    } catch (err) {
      logError(ERRORS.ANALYSIS_REGRID, err, { deck: side, bpm: seedBpm });
      return null;
    } finally {
      if (loadIdRef.current === loadId) setAnalyzing(null);
    }
  };

  return {
    fileName,
    loadError,
    objectUrl,
    waveData,
    bandIndex,
    bandLow,
    bufferDuration,
    tags,
    musicalKey,
    analyzing,
    loadTrack,
    onFile,
    regrid,
  };
}

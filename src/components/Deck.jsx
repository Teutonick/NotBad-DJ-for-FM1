import {
  memo,
  useEffect,
  useRef,
  useState,
  useMemo,
  useImperativeHandle,
} from "react";
import Fader from "./Fader";
import LcdDisplay from "./LcdDisplay";
import WaveScreen from "./WaveScreen";
import StructureIndicator from "./StructureIndicator";
import PadButton, { GLOSS, PRESS } from "./PadButton";
import PositionTools from "./deck/PositionTools";
import BpmTools from "./deck/BpmTools";
import LoopTools from "./deck/LoopTools";
import { MAX_SAVED_LOOPS } from "../lib/constants";
import {
  emptyHotCues,
  hotCuesToSlots,
  nextLoopId,
  sanitizeLoopRegion,
  sanitizeName,
  sanitizeSavedLoops,
  slotsToHotCues,
} from "../lib/cuePoints";
import {
  autoLoop as computeAutoLoop,
  beatsLabel,
  loopLengthBeats,
  moveLoop,
  nearestBeat,
  resizeLoop,
  rollExitTime,
  rollLoop,
  wrapTime,
} from "../audio/loops";
import { useI18n } from "../i18n/context";
import {
  analyzeTrackLoudness,
  analyzeWaveform,
  computeAutoGainDb,
} from "../audio/utils";
import {
  buildBeatGrid,
  computeOnsetEnvelope,
  detectTempoAsync,
  nudgeAnchor,
  tapInterval,
  scaleBpm,
  stretchBpm,
} from "../audio/beatGrid";
import { sanitizeStructure } from "../audio/structure";
import { endWarnSeconds, resolveStructurePrefs } from "../lib/structurePrefs";
import { detectKey } from "../audio/keyDetect";
import { keyLabel } from "../lib/camelot";
import { readTrackMetadata } from "../audio/metadata";
import { ERRORS, logError, logWarn } from "../lib/log";
import { formatClock, stripExtension } from "../lib/format";
import { useTrackStructure } from "../hooks/useTrackStructure";
import { useBend } from "../hooks/useBend";
import { usePlaybackRate } from "../hooks/usePlaybackRate";

// Redondeo de la fila de transporte (play, stop, sync, key): uno solo para
// los cuatro, que antes no coincidían entre ellos.
// Los botones de zoom van ENCIMA de la onda, así que su gris es un punto más
// claro que el de los demás: sobre el lienzo, el de siempre se perdía.
const ZOOM_BTN = `px-2 py-0.5 rounded bg-gradient-to-b from-neutral-600 to-neutral-700 hover:from-neutral-500 hover:to-neutral-600 ${GLOSS} ${PRESS}`;

const TRANSPORT_RADIUS = "rounded-xl";

// Pestañas de la fila de herramientas, en el orden en que se usan: primero lo
// que SITÚA la pista, luego lo que la mueve y al final lo momentáneo.
const TOOL_TABS = [
  // Agrupadas por lo que hacen, no por caja: colocar la pista, ajustar su
  // rejilla y todo lo de dar vueltas.
  { id: "position", labelKey: "toolsPosition" },
  { id: "bpm", labelKey: "toolsBpm" },
  { id: "loops", labelKey: "toolsLoops" },
];

// Ajustes de estructura por defecto, para cuando el deck se monta suelto
// (tests) y no le llegan los del diálogo ⚙. Identidad estable a propósito.
const DEFAULT_STRUCTURE_PREFS = resolveStructurePrefs({});

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

function Deck({
  colorClass,
  engine,
  side,
  pitchPct,
  setPitchPct,
  pitchRange,
  bendRange,
  keyLock,
  setKeyLock,
  onAttachEl,
  onAutoGainComputed,
  onBpmDetected,
  onAnalysis,
  onSync,
  canSync,
  syncActive,
  syncLabel,
  onPlayed,
  onPlayingChange,
  onTrackMeta,
  onCues,
  onStructure,
  onPhraseSize,
  structurePrefs,
  showKey = true,
  onLocalLoad,
  wavePalette,
  externalTrack,
  isActive,
  onActivate,
  lockLoadWhilePlaying,
  ref,
}) {
  const { t } = useI18n();
  const audioRef = useRef(null);
  const fileInputRef = useRef(null);

  // === Forma de onda / análisis ===
  const [waveData, setWaveData] = useState(null);
  const [bandIndex, setBandIndex] = useState(null);
  // Energía de graves por muestra: sale de la MISMA pasada que la onda y es
  // de donde salen los kicks del análisis de estructura.
  const [bandLow, setBandLow] = useState(null);
  // === Estructura (tramos con ritmo / sin ritmo + frase) ===
  // Se calcula una sola vez, al cargar, y se guarda con la pista. Lo que
  // ajuste el usuario a mano (`manual`) no lo pisa el análisis.
  // === Rejilla de beats ===
  // BPM base de la pista (el analizado, o el que haya dejado el usuario a
  // mano). NO incluye el pitch: el pitch va aparte, en el fader.
  const [bpm, setBpm] = useState(null);
  // Ancla: instante (en segundos) donde cae un beat. Toda la rejilla se
  // deriva de (bpm, ancla), así que moverla es mover este valor.
  const [gridAnchor, setGridAnchor] = useState(0);
  // La rejilla la ha tocado el usuario: el análisis automático ya no la pisa
  // y el ajuste se guarda en IndexedDB.
  const [gridManual, setGridManual] = useState(false);
  // Duración según el buffer decodificado: está disponible antes que la del
  // <audio>, y así la rejilla se puede dibujar en cuanto acaba el análisis.
  const [bufferDuration, setBufferDuration] = useState(0);
  // Envolvente de onsets de la pista (~200 KB). Se guarda para poder
  // reanalizar sobre el ajuste manual sin volver a decodificar el audio.
  const envelopeRef = useRef(null);
  // La pista llegó con una rejilla ajustada a mano: no la sobreescribimos
  const cachedGridRef = useRef(false);

  // Etiquetas ID3 y tonalidad de la pista cargada
  const [tags, setTags] = useState(null); // {artist, title, album}
  const [musicalKey, setMusicalKey] = useState(null); // {pitchClass, mode, confidence}
  const keyIdleRef = useRef(null);
  // Datos que ya venían analizados desde la lista: evitan repetir el trabajo
  const cachedKeyRef = useRef(null);
  // Token de carga: descarta los resultados asíncronos de una pista anterior
  // si mientras tanto se ha cargado otra en este deck
  const loadIdRef = useRef(0);
  const onTrackMetaRef = useRef(onTrackMeta);
  onTrackMetaRef.current = onTrackMeta;
  const onPlayingChangeRef = useRef(onPlayingChange);
  onPlayingChangeRef.current = onPlayingChange;

  // Pestaña de herramientas abierta en este deck
  const [tool, setTool] = useState(TOOL_TABS[0].id);

  const [zoom, setZoom] = useState(64);

  const [fileName, setFileName] = useState("");
  const [objectUrl, setObjectUrl] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);

  // CUE: posición de arranque. Se fija al posicionar la pista en pausa,
  // o automáticamente al inicio del sonido / primer beat detectado
  const [cuePoint, setCuePoint] = useState(0);
  const cueManualRef = useRef(false);

  // Hot cues: ranuras de tamaño fijo, hotCues[i] = null | { t, name }.
  // Se guardan por pista en IndexedDB y se restauran al volver a cargarla.
  const [hotCues, setHotCues] = useState(emptyHotCues);
  // Loops guardados de la pista y cuál está seleccionado en la lista
  const [savedLoops, setSavedLoops] = useState([]);
  const [savedLoopIdx, setSavedLoopIdx] = useState(0);
  // Loop activo
  const [loopIn, setLoopIn] = useState(null);
  const [loopOut, setLoopOut] = useState(null);
  const [loopOn, setLoopOn] = useState(false);
  // Longitud del loop en BEATS cuando se conoce (automáticos, roll, doblar y
  // partir). Con IN/OUT a mano es null y las cuentas van en segundos.
  const [loopBeats, setLoopBeats] = useState(null);
  // Loop roll en curso: { beats }. Mientras dura, el loop activo es el del
  // roll y el que hubiera antes espera en rollRef para volver al soltar.
  const [rolling, setRolling] = useState(null);
  // Editor de nombre abierto: { kind: "cue" | "loop", index, value }
  const [naming, setNaming] = useState(null);

  // Longitud del loop para la UI: en beats cuando cuadra con la rejilla, en
  // segundos cuando el IN/OUT se puso a mano fuera de ella.
  const loopLabel =
    loopIn != null && loopOut != null
      ? loopBeats
        ? `${beatsLabel(loopBeats)} \u266a`
        : `${(loopOut - loopIn).toFixed(2)} s`
      : "\u2014";

  // Fase de análisis para feedback en UI: null | "wave" | "bpm" | "regrid"
  const [analyzing, setAnalyzing] = useState(null);

  const { bendPct, startBend, releaseBend, nudge: onNudge } = useBend(bendRange);

  const [reverseAdvancedTime, setReverseAdvancedTime] = useState(true);

  const livePitch = useMemo(() => pitchPct + bendPct, [pitchPct, bendPct]);

  // BPM efectivo (corriendo) = BPM base × factor de tempo
  const runningBpm = useMemo(() => {
    if (!bpm) return null;
    const factor = 1 + (pitchPct + bendPct) / 100;
    return bpm * factor;
  }, [bpm, pitchPct, bendPct]);

  // La rejilla SIEMPRE se deriva de (bpm, ancla, duración). Por eso cualquier
  // ajuste manual se propaga solo a todo lo que la usa: marcas de la onda,
  // quantize, loops automáticos de 4/8, beat jump y el panel de beat match.
  const gridDuration = duration || bufferDuration;
  const beats = useMemo(
    () => buildBeatGrid(bpm, gridAnchor, gridDuration),
    [bpm, gridAnchor, gridDuration]
  );

  const onAnalysisRef = useRef(onAnalysis);
  onAnalysisRef.current = onAnalysis;
  useEffect(() => {
    onAnalysisRef.current?.(side, { beats });
  }, [beats, side]);

  // === Estructura de la pista ===
  //
  // Los tramos se guardan en SEGUNDOS y los índices de beat se recalculan
  // contra la rejilla actual: así un ajuste manual de rejilla no descuadra la
  // cuenta atrás. Es una función pura sobre media docena de tramos.
  const prefs = structurePrefs || DEFAULT_STRUCTURE_PREFS;
  const phraseSize = prefs.phraseSize;
  const {
    structure,
    gridStructure,
    restore: restoreStructure,
    shiftPhrase,
    resetPhrase,
    redetectStructure,
  } = useTrackStructure({
    bandLow,
    beats,
    bufferDuration,
    phraseSize,
    objectUrl,
    side,
    onStructure,
  });

  // Aviso de fin de pista: segundos que quedan cuando empieza a parpadear
  const endWarnAt = useMemo(
    () => endWarnSeconds(prefs.endWarn, duration || bufferDuration),
    [prefs.endWarn, duration, bufferDuration]
  );

  const round2 = (v) => Math.round(v * 100) / 100;

  // Punto ÚNICO de cambio de rejilla: BPM base + ancla. Avisa al padre, que
  // lo usa para el SYNC entre decks y para persistirlo en IndexedDB.
  const applyGrid = (nextBpm, nextAnchor, manual) => {
    const anchor = Number.isFinite(nextAnchor) ? nextAnchor : gridAnchor;
    const isManual = manual === undefined ? gridManual : manual;
    setBpm(nextBpm);
    setGridAnchor(anchor);
    setGridManual(isManual);
    if (typeof onBpmDetected === "function") {
      onBpmDetected(side, nextBpm, { anchor, manual: isManual });
    }
  };

  const getFilenameWithoutExtension = () => {
    return stripExtension(fileName) || t("noFile");
  };


  // === Waveform + bandas + loudness (una sola pasada por el buffer) ===
  // `name` solo se usa para el registro: el estado fileName todavía tiene
  // el de la pista anterior cuando esto corre
  async function extractWaveform(arrayBuffer, loadId, name) {
    const audioBuffer = await engine.ctx.decodeAudioData(arrayBuffer);

    const duration = audioBuffer.duration;
    setBufferDuration(duration);
    const { waveData: norm, bandIndex: bands, bandLow: low, peak } =
      analyzeWaveform(audioBuffer);

    setWaveData(norm);
    setBandIndex(bands);
    setBandLow(low);
    if (typeof onAnalysis === "function") {
      onAnalysis(side, { waveData: norm, duration });
    }

    // Auto-cue provisional: inicio del sonido (primer bloque no silencioso)
    const onsetIdx = norm.findIndex((v) => v > 0.05);
    if (onsetIdx > -1) {
      const onsetTime = (onsetIdx / norm.length) * duration;
      applyAutoCue(onsetTime);
    }

    // Loudness de TODA la pista, calculado una sola vez al cargarla: nunca se
    // vuelve a mover durante la reproducción
    const { loudDb } = analyzeTrackLoudness(audioBuffer);
    const gainDb = computeAutoGainDb({ loudDb, peak });

    if (typeof onAutoGainComputed === "function") {
      onAutoGainComputed(side, gainDb);
    }
    setAnalyzing("bpm");
    detectBeats({ audioBuffer, loadId });

    // Tonalidad: aprovecha el MISMO AudioBuffer, sin otro fetch ni otro
    // decode. Bloquea el hilo principal unos cientos de ms, así que se deja
    // para un hueco libre y solo si la pista no la traía ya analizada.
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

  // Auto-cue: solo si el usuario no ha fijado un cue manual.
  // Si el deck está parado, colocamos también la pista en el cue.
  const applyAutoCue = (time) => {
    if (cueManualRef.current) return;
    setCuePoint(time);
    const el = audioRef.current;
    if (el && el.paused) {
      el.currentTime = time;
      setCurrent(time);
    }
  };

  // === Detección de BPM y rejilla ===
  // Trabaja sobre el AudioBuffer YA decodificado: nada de volver a leer el
  // blob que está reproduciendo el <audio> (eso congelaba la reproducción si
  // se pulsaba Play durante el análisis).
  async function detectBeats({ audioBuffer, loadId }) {
    try {
      // La envolvente se calcula siempre, aunque la rejilla venga ajustada a
      // mano: es lo que necesita después el reanálisis guiado.
      const envelope = await computeOnsetEnvelope(audioBuffer);
      if (loadIdRef.current !== loadId) return;
      envelopeRef.current = envelope;

      if (cachedGridRef.current) return; // rejilla manual guardada: no se toca

      const info = envelope ? await detectTempoAsync(envelope) : null;
      if (loadIdRef.current !== loadId) return;

      if (!info?.bpm) {
        applyGrid(null, 0, false);
        return;
      }
      applyGrid(round2(info.bpm), info.anchor, false);
      // Auto-cue definitivo: primer beat detectado
      applyAutoCue(info.anchor);
    } catch (err) {
      logError(ERRORS.ANALYSIS_BEATS, err, { deck: side });
      if (loadIdRef.current === loadId) applyGrid(null, 0, false);
    } finally {
      if (loadIdRef.current === loadId) setAnalyzing(null);
    }
  }

  // === TAP de rejilla (estilo Traktor) ===
  // Pulsando al ritmo mientras suena: cada tap reancla la rejilla de beats a
  // ese instante, y con 2+ taps se recalcula el BPM. Los taps se guardan en
  // TIEMPO DE PISTA, así el pitch no falsea el cálculo.
  const tapRef = useRef({ taps: [], lastWall: 0 });

  const onTapBeat = () => {
    const el = audioRef.current;
    if (!el || !objectUrl) return;
    const now = performance.now();
    const st = tapRef.current;
    // una pausa larga entre taps empieza una secuencia nueva
    if (now - st.lastWall > 2500) st.taps = [];
    st.lastWall = now;
    st.taps.push(el.currentTime || 0);
    if (st.taps.length > 16) st.taps.shift();

    const taps = st.taps;
    const anchor = taps[taps.length - 1];

    const interval = tapInterval(taps, bpm);
    if (!interval) return; // sin BPM previo y con un solo tap no hay rejilla
    applyGrid(round2(60 / interval), anchor, true);
  };

  // === Ajuste manual de la rejilla ===
  // Dos ejes independientes: la FASE (dónde empieza) y la SEPARACIÓN entre
  // beats (el BPM base de la pista). Ninguno de los dos toca el pitch.
  // Las operaciones viven en src/audio/beatGrid.js (funciones puras); aquí
  // solo se aplican al estado del deck.
  const nudgeGrid = (deltaSec) => {
    if (!bpm) return;
    applyGrid(bpm, nudgeAnchor(gridAnchor, deltaSec), true);
  };

  const stretchGrid = (deltaBpm) => {
    const next = stretchBpm(bpm, deltaBpm);
    if (next == null) return;
    applyGrid(next, gridAnchor, true);
  };

  const scaleGrid = (factor) => {
    const next = scaleBpm(bpm, factor);
    if (next == null) return;
    applyGrid(next, gridAnchor, true);
  };

  // Reanálisis guiado: busca el mejor encaje ALREDEDOR del BPM y el ancla que
  // ha dejado el usuario, no desde cero. Reutiliza la envolvente de onsets,
  // así que no hay ni fetch ni decode.
  const regridFromManual = async () => {
    const envelope = envelopeRef.current;
    if (!envelope || !bpm || analyzing) return;
    const loadId = loadIdRef.current;
    setAnalyzing("regrid");
    try {
      const info = await detectTempoAsync(envelope, {
        seedBpm: bpm,
        seedAnchor: gridAnchor,
        bpmTolerance: 6,
      });
      // Si mientras tanto se ha cargado otra pista, el resultado no vale
      if (loadIdRef.current !== loadId) return;
      if (info?.bpm) applyGrid(round2(info.bpm), info.anchor, true);
    } catch (err) {
      logError(ERRORS.ANALYSIS_REGRID, err, { deck: side, bpm });
    } finally {
      if (loadIdRef.current === loadId) setAnalyzing(null);
    }
  };

  // conectar el mediaElement al engine + listeners básicos del <audio>
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    onAttachEl(side, el);

    const onTimeUpdate = () => setCurrent(el.currentTime || 0);
    const onLoadedMetadata = () => setDuration(el.duration || 0);
    const onEnded = () => {
      setIsPlaying(false);
      onPlayingChangeRef.current?.(side, false);
    };

    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("loadedmetadata", onLoadedMetadata);
    el.addEventListener("ended", onEnded);

    return () => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("loadedmetadata", onLoadedMetadata);
      el.removeEventListener("ended", onEnded);
    };
  }, [onAttachEl, side]);

  // Key lock: preservesPitch=true mantiene el tono al cambiar el tempo;
  // false = modo vinilo (el pitch cambia el tono)
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.preservesPitch = !!keyLock;
  }, [keyLock]);

  // limpiar URL de archivo
  useEffect(
    () => () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
    [objectUrl]
  );

  useEffect(() => () => keyIdleRef.current?.(), []);

  // La tonalidad de la pista cargada sube al padre (venga del análisis o de
  // la caché de la lista): la usa la lista para marcar compatibilidades
  useEffect(() => {
    onTrackMetaRef.current?.(side, { musicalKey });
  }, [musicalKey, side]);

  // Bloqueo de carga: con la opción puesta, un deck que está sonando no
  // admite otra pista. Se comprueba aquí, el único punto por el que pasan
  // TODAS las vías de carga (botón del deck y lista de canciones).
  const lockLoadRef = useRef(lockLoadWhilePlaying);
  lockLoadRef.current = lockLoadWhilePlaying;
  const loadBlocked = Boolean(lockLoadWhilePlaying && isPlaying);

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
    const hasManualGrid = Boolean(
      cached?.gridManual && cached?.bpm > 0 && Number.isFinite(cached?.gridAnchor)
    );
    cachedGridRef.current = hasManualGrid;
    envelopeRef.current = null;
    setBufferDuration(0);

    setFileName(f.name);
    setWaveData(null);
    setBandIndex(null);
    setBandLow(null);
    // Estructura guardada de ESTA pista: se restaura tal cual y el análisis
    // no la vuelve a calcular (ni pisa el ajuste manual de frase).
    restoreStructure(sanitizeStructure(cached?.structure));
    setMusicalKey(cached?.musicalKey || null);
    setTags(
      cached?.artist || cached?.title
        ? { artist: cached.artist, title: cached.title, album: cached.album }
        : null
    );
    applyGrid(hasManualGrid ? cached.bpm : null, hasManualGrid ? cached.gridAnchor : 0, hasManualGrid);
    setCuePoint(0);
    // Hot cues y loops guardados de ESTA pista. Son del usuario: se restauran
    // tal cual y el análisis no los toca nunca.
    setHotCues(hotCuesToSlots(cached?.hotCues));
    setSavedLoops(sanitizeSavedLoops(cached?.savedLoops));
    setSavedLoopIdx(0);
    // El último loop marcado vuelve donde estaba, pero APAGADO: al cargar una
    // pista nadie espera que empiece a dar vueltas sola.
    const cachedLoop = sanitizeLoopRegion(cached?.activeLoop);
    rollRef.current = null;
    setRolling(null);
    setNaming(null);
    setLoopIn(cachedLoop?.start ?? null);
    setLoopOut(cachedLoop?.end ?? null);
    setLoopBeats(cachedLoop?.beats ?? null);
    setLoopOn(false);
    cueManualRef.current = false;
    setAnalyzing("wave");
    if (typeof onAnalysis === "function") {
      onAnalysis(side, { waveData: null, duration: 0 });
    }

    // Etiquetas ID3: no dependen del decode, así que se leen en paralelo y
    // aparecen en cuanto están (normalmente antes que la onda)
    if (!cached?.title && !cached?.artist) {
      readTrackMetadata(f).then((meta) => {
        if (loadIdRef.current !== loadId) return; // ya hay otra pista cargada
        if (meta.artist || meta.title) {
          setTags({ artist: meta.artist, title: meta.title, album: meta.album });
        }
        onTrackMetaRef.current?.(side, meta);
      });
    }

    (async () => {
      // Copia propia de los bytes: si el mismo archivo se carga en los dos
      // decks, dos <audio> leyendo el MISMO File en streaming se atascan
      // (la reproducción se congela); con una copia por deck no
      const arrayBuffer = await f.arrayBuffer();
      const blobCopy = new Blob([arrayBuffer], {
        type: f.type || "audio/mpeg",
      });
      const url = URL.createObjectURL(blobCopy);
      setObjectUrl(url);

      const el = audioRef.current;
      if (el) {
        el.src = url;
        el.load();
        el.preservesPitch = !!keyLock;
      }
      setIsPlaying(false);
      setCurrent(0);
      setDuration(0);

      // decodeAudioData "consume" (detach) el arrayBuffer, por eso la copia
      // del blob se hace antes
      await extractWaveform(arrayBuffer, loadId, f.name);
    })().catch((err) => {
      logError(ERRORS.TRACK_LOAD, err, { deck: side, file: f.name });
      setAnalyzing(null);
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
    // Lo que la lista ya tenga analizado se reutiliza tal cual
    loadTrackRef.current(tr.file, {
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
    });
  }, [externalTrack?.loadToken, externalTrack?.file]);

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    // Este archivo no viene de la lista: se avisa al padre para que suelte el
    // vínculo con la pista que hubiera cargada y no le escriba encima cues,
    // loops ni rejilla de otra canción.
    onLocalLoad?.(side);
    loadTrack(f);
    e.target.value = ""; // permite volver a elegir el mismo archivo
  };

  const play = async () => {
    await engine?.resume();
    const el = audioRef.current;
    if (!el) return;
    try {
      await el.play();
      setIsPlaying(true);
      onPlayingChange?.(side, true);
      if (typeof onPlayed === "function") onPlayed(side);
    } catch (e) {
      logError(ERRORS.AUDIO_PLAY, e, { deck: side, file: fileName });
    }
  };

  const pause = () => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    setIsPlaying(false);
    onPlayingChange?.(side, false);
  };

  // STOP vuelve al punto CUE (0 si no hay cue)
  const stop = () => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    el.currentTime = cuePoint;
    setCurrent(cuePoint);
    setIsPlaying(false);
    onPlayingChange?.(side, false);
  };

  // Posicionar la pista en pausa fija el CUE en ese punto
  const setCueIfPaused = (time) => {
    const el = audioRef.current;
    if (!el || !el.paused) return;
    cueManualRef.current = true;
    setCuePoint(time);
  };

  // Arrastre de la onda en pausa: empujar la pista hasta la línea de reproducción
  const onDragSeek = (time) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = time;
    setCurrent(time);
    setCueIfPaused(time);
  };

  // Handlers del canvas con identidad estable: así WaveformCanvas (memo) no
  // se re-renderiza en cada movimiento del fader de pitch
  const waveHandlersRef = useRef({});
  const stableWave = useMemo(
    () => ({
      onSeek: (...a) => waveHandlersRef.current.onSeek?.(...a),
      onDragSeek: (...a) => waveHandlersRef.current.onDragSeek?.(...a),
      onNudge: (...a) => waveHandlersRef.current.onNudge?.(...a),
      onNudgeEnd: (...a) => waveHandlersRef.current.onNudgeEnd?.(...a),
      onWheelZoom: (...a) => waveHandlersRef.current.onWheelZoom?.(...a),
      onOverviewSeek: (...a) => waveHandlersRef.current.onOverviewSeek?.(...a),
    }),
    []
  );

  // === Quantize: imanta cues/loops/saltos al beat más cercano ===
  // Apagado de partida: imantar por sorpresa un cue o un loop que has puesto
  // a mano desconcierta más de lo que ayuda.
  const [quantize, setQuantize] = useState(false);
  const snapToGrid = (time) =>
    quantize ? nearestBeat(beats, time) : time;

  // === Beat jump (estilo Traktor): salto de N beats adelante/atrás ===
  const [jumpBeats, setJumpBeats] = useState(4);
  const beatJump = (dir) => {
    const el = audioRef.current;
    if (!el || !bpm) return;
    const dt = dir * jumpBeats * (60 / bpm);
    const dur = duration || el.duration || 0;
    const base = snapToGrid(el.currentTime || 0);
    const time = Math.max(0, Math.min(Math.max(0, dur - 0.01), base + dt));
    el.currentTime = time;
    setCurrent(time);
    setCueIfPaused(time);
  };

  // === Hot cues ===
  // Click fija (si está vacío) o salta; click derecho o Shift+click borra;
  // doble click abre el editor de nombre.
  const triggerHotCue = (i) => {
    const el = audioRef.current;
    if (!el || !objectUrl) return;
    const cue = hotCues[i];
    if (!cue) {
      const next = [...hotCues];
      next[i] = { t: snapToGrid(el.currentTime || 0), name: "" };
      setHotCues(next);
    } else {
      el.currentTime = cue.t;
      setCurrent(cue.t);
    }
  };

  const clearHotCue = (i) => {
    setNaming((n) => (n?.kind === "cue" && n.index === i ? null : n));
    setHotCues((prev) => {
      if (!prev[i]) return prev;
      const next = [...prev];
      next[i] = null;
      return next;
    });
  };

  const renameHotCue = (i, name) => {
    setHotCues((prev) => {
      if (!prev[i]) return prev;
      const next = [...prev];
      next[i] = { ...next[i], name: sanitizeName(name) };
      return next;
    });
  };

  // === Loop ===
  // Punto único por el que pasan TODOS los cambios de región del loop: así la
  // longitud en beats y el motor del salto no se desincronizan nunca.
  const applyLoop = (region, on) => {
    setLoopIn(region?.start ?? null);
    setLoopOut(region?.end ?? null);
    setLoopBeats(region?.beats ?? null);
    setLoopOn(Boolean(region && on));
  };

  const setLoopInNow = () => {
    const el = audioRef.current;
    if (!el || !objectUrl) return;
    setLoopIn(snapToGrid(el.currentTime || 0));
    setLoopOut(null);
    setLoopBeats(null);
    setLoopOn(false);
  };

  const setLoopOutNow = () => {
    const el = audioRef.current;
    if (!el || loopIn == null) return;
    const raw = el.currentTime || 0;
    const snapped = snapToGrid(raw);
    // si el snap lo dejaría pegado o antes del IN, usar el punto crudo
    const time = snapped > loopIn + 0.05 ? snapped : raw;
    if (time <= loopIn + 0.05) return;
    setLoopOut(time);
    // Longitud en beats solo si cuadra con la rejilla (ver loopLengthBeats)
    setLoopBeats(loopLengthBeats(loopIn, time, bpm));
    setLoopOn(true);
  };

  const toggleLoop = () => {
    if (loopIn != null && loopOut != null) setLoopOn((v) => !v);
  };

  // Loop automático de N beats anclado al beat anterior más cercano
  const autoLoop = (nBeats) => {
    const el = audioRef.current;
    if (!el || !objectUrl) return;
    const region = computeAutoLoop({
      bpm,
      beats,
      time: el.currentTime || 0,
      lengthBeats: nBeats,
      duration: gridDuration,
    });
    if (region) applyLoop(region, true);
  };

  // Mueve el loop entero una longitud hacia delante o hacia atrás. Si está
  // sonando dentro, el playhead se mueve con él y conserva su sitio relativo.
  const moveLoopBy = (dir) => {
    if (loopIn == null || loopOut == null) return;
    const next = moveLoop({
      start: loopIn,
      end: loopOut,
      dir,
      duration: gridDuration,
    });
    if (!next) return;
    const el = audioRef.current;
    const cur = el?.currentTime ?? null;
    setLoopIn(next.start);
    setLoopOut(next.end);
    if (el && loopOn && cur != null && cur >= loopIn && cur <= loopOut) {
      const time = next.start + (cur - loopIn);
      el.currentTime = time;
      setCurrent(time);
    }
  };

  // Dobla (2) o parte (0,5) la longitud manteniendo el punto de entrada
  const resizeLoopBy = (factor) => {
    if (loopIn == null || loopOut == null) return;
    const next = resizeLoop({
      start: loopIn,
      end: loopOut,
      factor,
      bpm,
      lengthBeats: loopBeats,
      duration: gridDuration,
    });
    if (!next) return;
    setLoopOut(next.end);
    setLoopBeats(next.beats);
    // Al partir, el playhead puede quedarse fuera del tramo nuevo: se le mete
    // dentro por donde le tocaría, sin esperar a la siguiente vuelta.
    const el = audioRef.current;
    if (el && loopOn && !el.paused) {
      const cur = el.currentTime || 0;
      if (cur >= next.end) {
        const time = wrapTime({ current: cur, start: next.start, end: next.end });
        el.currentTime = time;
        setCurrent(time);
      }
    }
  };

  // === Loop roll ===
  // Loop momentáneo mientras se mantiene pulsado. Al soltar, la reproducción
  // sigue DONDE ESTARÍA si el roll no hubiera ocurrido (rollExitTime), no
  // donde quedó el bucle.
  const rollRef = useRef(null);

  const startRoll = (lengthBeats) => {
    const el = audioRef.current;
    if (!el || !objectUrl || rollRef.current) return;
    const region = rollLoop({
      bpm,
      gridAnchor,
      time: el.currentTime || 0,
      lengthBeats,
      quantize,
      duration: gridDuration,
    });
    if (!region) return;
    rollRef.current = {
      prev: { in: loopIn, out: loopOut, on: loopOn, beats: loopBeats },
      length: region.end - region.start,
    };
    loopRef.current.wraps = 0;
    applyLoop(region, true);
    setRolling({ beats: lengthBeats });
  };

  const endRoll = () => {
    const st = rollRef.current;
    if (!st) return;
    rollRef.current = null;
    // Se apaga el motor a mano ANTES de recolocar el playhead: si no, el
    // temporizador que aún está armado vería la posición de salida como un
    // "pasado del OUT" y devolvería la pista al bucle.
    loopRef.current.on = false;
    const el = audioRef.current;
    if (el) {
      const exit = rollExitTime({
        current: el.currentTime || 0,
        wraps: loopRef.current.wraps,
        loopLength: st.length,
        duration: gridDuration || el.duration || 0,
      });
      el.currentTime = exit;
      setCurrent(exit);
    }
    loopRef.current.wraps = 0;
    setRolling(null);
    // Se deja todo como estaba, campo a campo: con applyLoop un IN puesto
    // sin OUT (loop a medio marcar) se perdía al soltar el roll.
    const { prev } = st;
    setLoopIn(prev.in);
    setLoopOut(prev.out);
    setLoopBeats(prev.beats);
    setLoopOn(Boolean(prev.in != null && prev.out != null && prev.on));
  };

  // === Loops guardados (por pista) ===
  const saveCurrentLoop = () => {
    if (loopIn == null || loopOut == null) return;
    if (savedLoops.length >= MAX_SAVED_LOOPS) return;
    const next = [
      ...savedLoops,
      {
        id: nextLoopId(savedLoops),
        start: loopIn,
        end: loopOut,
        beats: loopBeats,
        // Nombre por defecto: la longitud en beats, que es lo que identifica
        // un loop de un vistazo. Se puede cambiar con ✎.
        name: loopBeats ? beatsLabel(loopBeats) : `L${savedLoops.length + 1}`,
      },
    ];
    setSavedLoops(next);
    setSavedLoopIdx(next.length - 1);
  };

  const recallSavedLoop = (idx = savedLoopIdx) => {
    const loop = savedLoops[idx];
    if (!loop) return;
    applyLoop(loop, true);
    setSavedLoopIdx(idx);
    const el = audioRef.current;
    if (el) {
      el.currentTime = loop.start;
      setCurrent(loop.start);
    }
  };

  // Si ya está sonando ese mismo loop, la tecla lo apaga
  const toggleSavedLoop = () => {
    const loop = savedLoops[savedLoopIdx];
    if (!loop) return;
    if (loopOn && loopIn === loop.start && loopOut === loop.end) {
      setLoopOn(false);
      return;
    }
    recallSavedLoop(savedLoopIdx);
  };

  const deleteSavedLoop = (idx) => {
    setNaming((n) => (n?.kind === "loop" ? null : n));
    setSavedLoops((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      setSavedLoopIdx((cur) => Math.max(0, Math.min(cur, next.length - 1)));
      return next;
    });
  };

  const renameSavedLoop = (idx, name) => {
    setSavedLoops((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, name: sanitizeName(name) } : l))
    );
  };

  const selectSavedLoop = (dir) => {
    if (!savedLoops.length) return;
    setSavedLoopIdx(
      (i) => (i + dir + savedLoops.length) % savedLoops.length
    );
  };

  // === Motor del loop ===
  // Comprobar la posición una vez por frame deja 17 ms de margen: en un loop
  // de 1/8 de beat (≈59 ms a 128 BPM) eso es casi un tercio de su longitud y
  // el tropiezo se oye. Aquí se programa un temporizador para el instante del
  // salto y solo en los últimos milisegundos se hila fino a base de ticks
  // cortos. Además el retraso que quede se ARRASTRA al punto de entrada
  // (wrapTime), así el bucle mantiene la fase aunque el aviso llegue tarde.
  const loopRef = useRef({ on: false, start: 0, end: 0, wraps: 0, gen: 0 });
  const loopActive = loopOn && loopIn != null && loopOut != null;
  {
    const st = loopRef.current;
    const start = loopIn ?? 0;
    const end = loopOut ?? 0;
    if (st.start !== start || st.end !== end) {
      st.start = start;
      st.end = end;
      st.wraps = 0;
      st.gen++;
    }
    st.on = loopActive;
  }

  useEffect(() => {
    if (!loopActive) return;
    const el = audioRef.current;
    if (!el) return;
    const FINE_MS = 12; // tramo final que se apura con ticks cortos
    const gen = loopRef.current.gen;
    let timer = null;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const st = loopRef.current;
      if (st.gen !== gen) return; // manda otra región: este temporizador sobra
      if (!st.on || el.paused) {
        timer = setTimeout(tick, 60); // nada que vigilar por ahora
        return;
      }
      const now = el.currentTime || 0;
      if (now >= st.end) {
        el.currentTime = wrapTime({ current: now, start: st.start, end: st.end });
        st.wraps += 1;
        timer = setTimeout(tick, 0);
        return;
      }
      const rate = el.playbackRate || 1;
      const remainMs = ((st.end - now) / rate) * 1000;
      timer = setTimeout(tick, remainMs > FINE_MS ? remainMs - FINE_MS : 0);
    };

    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loopActive, loopIn, loopOut]);

  // Los hot cues y los loops suben al padre, que los refleja en la lista y los
  // guarda en IndexedDB. Sin pista cargada no hay nada que guardar.
  const onCuesRef = useRef(onCues);
  onCuesRef.current = onCues;
  useEffect(() => {
    if (!objectUrl) return;
    onCuesRef.current?.(side, {
      hotCues: slotsToHotCues(hotCues),
      savedLoops,
      // El loop del roll es momentáneo: no se guarda como el loop de la pista
      activeLoop:
        !rolling && loopIn != null && loopOut != null
          ? { start: loopIn, end: loopOut, beats: loopBeats }
          : undefined,
    });
  }, [hotCues, savedLoops, loopIn, loopOut, loopBeats, rolling, objectUrl, side]);

  // API imperativa para atajos de teclado (MiniDJPlayer)
  useImperativeHandle(ref, () => ({
    playPause: () => (isPlaying ? pause() : play()),
    cueStop: stop,
    hotCue: triggerHotCue,
    hotCueClear: clearHotCue,
    loopIn: setLoopInNow,
    loopOut: setLoopOutNow,
    loopToggle: toggleLoop,
    loopMove: moveLoopBy,
    loopResize: resizeLoopBy,
    rollStart: startRoll,
    rollEnd: endRoll,
    loopSave: saveCurrentLoop,
    loopSavedToggle: toggleSavedLoop,
    loopSavedSelect: selectSavedLoop,
    nudgeStart: (sign) => startBend(sign),
    nudgeEnd: () => releaseBend(),
  }));

  // Pitch / tempo: pitch + bend al playbackRate del <audio>
  usePlaybackRate(audioRef, pitchPct + bendPct);

  // El fader emite muchos eventos por frame al arrastrarlo; agrupamos la
  // actualización de estado en uno por frame para no re-renderizar de más
  const pitchPendingRef = useRef(null);
  const pitchCommitRef = useRef(null);
  const onPitchChange = (val) => {
    const v = Math.max(-pitchRange, Math.min(pitchRange, Number(val)));
    pitchPendingRef.current = v;
    if (pitchCommitRef.current) return;
    pitchCommitRef.current = requestAnimationFrame(() => {
      pitchCommitRef.current = null;
      const pending = pitchPendingRef.current;
      if (pending != null) setPitchPct(side, pending);
    });
  };

  useEffect(
    () => () => {
      if (pitchCommitRef.current) cancelAnimationFrame(pitchCommitRef.current);
    },
    []
  );


  waveHandlersRef.current = {
    onSeek: (time) => {
      const el = audioRef.current;
      if (!el) return;
      el.currentTime = time;
      setCurrent(time);
      setCueIfPaused(time);
    },
    onDragSeek,
    onNudge,
    onNudgeEnd: releaseBend,
    onWheelZoom: (dir) =>
      setZoom((z) => Math.max(1, Math.min(256, dir > 0 ? z * 2 : z / 2))),
    // Desde el resumen se salta a cualquier punto de la pista; la onda grande
    // va detrás, porque sigue siempre a la reproducción.
    onOverviewSeek: (frac) => {
      const el = audioRef.current;
      const dur = duration || bufferDuration || el?.duration || 0;
      if (!el || !(dur > 0)) return;
      const time = Math.max(0, Math.min(dur - 0.01, frac * dur));
      el.currentTime = time;
      setCurrent(time);
      setCueIfPaused(time);
    },
  };

  return (
    <div
      onPointerDown={() => onActivate?.(side)}
      className={`rounded-2xl border bg-neutral-900/70 p-4 sm:p-5 shadow-xl relative overflow-hidden min-w-0 ${
        isActive ? "border-sky-500/60 ring-1 ring-sky-500/40" : "border-neutral-800"
      }`}
    >
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${colorClass}`}
      />
      <div className="relative grid gap-4 min-w-0">
        <header className="flex items-start justify-between gap-3 min-w-0">
          <h2 className="text-lg font-semibold tracking-tight shrink-0 pt-1">
            {t("deck", { side })}
            {isActive && (
              <span
                className="ml-2 text-[9px] align-middle text-sky-400 border border-sky-500/40 rounded px-1 py-0.5"
                title={t("keyboardBadgeTitle")}
              >
                {t("keyboardBadge")}
              </span>
            )}
          </h2>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.ogg,.flac"
            onChange={onFile}
            className="hidden"
          />
        </header>
        {/* Content */}
        <div className="flex flex-row gap-3 w-full">
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            {/* Pantalla LCD: tiempo, duración, BPM, tonalidad, pitch y bend.
                Antes eran etiquetas sueltas repartidas por la tarjeta —dos de
                ellas encima del fader de pitch, que por eso era más corto. */}
            <LcdDisplay
              trackTitle={tags?.title || getFilenameWithoutExtension() || t("noFile")}
              trackInfo={
                [tags?.artist, tags?.album].filter(Boolean).join(" · ")
              }
              marqueeSpeed={prefs.marqueeSpeed}
              font={prefs.lcdFont}
              titleFont={prefs.titleFont}
              loadButton={
                // A la mínima expresión: solo el icono. El nombre de la pista
                // ya está a su izquierda, en la propia pantalla.
                <span
                  className="shrink-0"
                  title={loadBlocked ? t("loadLockedTitle", { side }) : t("loadFile")}
                >
                  <PadButton
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={loadBlocked}
                  >
                    {loadBlocked ? "🔒" : "📂"}
                  </PadButton>
                </span>
              }
              time={
                reverseAdvancedTime
                  ? `-${formatClock(duration - current)}`
                  : formatClock(current)
              }
              timeLabel={reverseAdvancedTime ? t("lcdRemaining") : t("lcdElapsed")}
              timeTitle={t("lcdTimeTitle")}
              onToggleTime={() => setReverseAdvancedTime((prev) => !prev)}
              cue={
                objectUrl
                  ? {
                      label: t("cue"),
                      title: t("cueTitle", { time: formatClock(cuePoint) }),
                      // El signo sale de la cifra YA redondeada: por debajo de
                      // un segundo estás en el cue, y un "−00:00" no dice nada
                      text: `${
                        current < cuePoint && cuePoint - current >= 1 ? "−" : "+"
                      }${formatClock(Math.abs(current - cuePoint))}`,
                    }
                  : null
              }
              duration={formatClock(duration)}
              durationLabel={t("lcdTotal")}
              bpm={bpm ? String(Math.round(bpm)) : "-"}
              bpmLabel={t("lcdTrackBpm")}
              bpmTitle={t("bpmDisplayTitle")}
              onBpmClick={onTapBeat}
              runningBpm={runningBpm ? String(Math.round(runningBpm)) : "-"}
              runningLabel={t("bpm")}
              musicalKey={
                showKey
                  ? musicalKey
                    ? keyLabel(musicalKey.pitchClass, musicalKey.mode)
                    : t("keyNone")
                  : null
              }
              keyKnown={Boolean(musicalKey)}
              keyLabel={t("lcdKey")}
              keyTitle={t("keyTitle")}
              pitch={`${livePitch > 0 ? "+" : ""}${livePitch.toFixed(2)}%`}
              pitchLabel={t("pitch")}
              pitchTitle={t("pitchFaderTitle")}
              bend={`${bendPct > 0 ? "+" : ""}${bendPct.toFixed(2)}%`}
              bendLabel={t("bend")}
              keyLock={keyLock}
            />
            {/* La pantalla del deck: onda ampliada + resumen de la pista */}
            <WaveScreen
              waveData={waveData}
              bandIndex={bandIndex}
              palette={wavePalette}
              beats={beats}
              structure={gridStructure}
              duration={gridDuration}
              audioRef={audioRef}
              cuePoint={cuePoint}
              hotCues={hotCues}
              loopIn={loopIn}
              loopOut={loopOut}
              loopOn={loopOn}
              loopRolling={Boolean(rolling)}
              endWarnAt={endWarnAt}
              zoom={zoom}
              onSeek={stableWave.onSeek}
              onDragSeek={stableWave.onDragSeek}
              onNudge={stableWave.onNudge}
              onNudgeEnd={stableWave.onNudgeEnd}
              onWheelZoom={stableWave.onWheelZoom}
              onOverviewSeek={stableWave.onOverviewSeek}
              overviewTitle={t("overviewTitle")}
            >
              {/* Estructura: cuántos kicks quedan hasta el próximo cambio.
                  Va en la esquina inferior derecha de la onda, con su propio
                  bucle: no re-renderiza el deck ni al cambiar la cuenta. */}
              {prefs.show && objectUrl && (
                <StructureIndicator
                  structure={gridStructure}
                  beats={beats}
                  audioRef={audioRef}
                  phraseSize={phraseSize}
                  phraseOffset={structure?.phraseOffset ?? 0}
                  unit={prefs.unit}
                  warnAmber={prefs.warnAmber}
                  warnRed={prefs.warnRed}
                />
              )}
              {/* Feedback de análisis */}
              {analyzing === "wave" && (
                <div className="absolute inset-0 flex items-center justify-center rounded-md bg-neutral-900/70 pointer-events-none">
                  <span className="text-xs text-neutral-300 animate-pulse">
                    {t("analyzingTrack")}
                  </span>
                </div>
              )}
              {(analyzing === "bpm" || analyzing === "regrid") && (
                <div className="absolute inset-x-0 bottom-1 flex justify-center pointer-events-none">
                  <span className="px-2 py-0.5 rounded bg-neutral-900/80 text-[10px] text-neutral-300 animate-pulse">
                    {analyzing === "regrid" ? t("regridding") : t("detectingBpm")}
                  </span>
                </div>
              )}
              {/* Zoom */}
              <div className="absolute right-1.5 top-1.5 flex gap-1.5 text-xs text-neutral-400">
                <button
                  onClick={() => setZoom((z) => Math.min(z * 2, 256))}
                  className={ZOOM_BTN}
                >
                  🔍+
                </button>
                <button
                  onClick={() => setZoom((z) => Math.max(z / 2, 1))}
                  className={ZOOM_BTN}
                >
                  🔍−
                </button>
              </div>
            </WaveScreen>
          </div>
          <div className="flex flex-col gap-2 w-24 shrink-0 items-center">
            {/* Pitch. Las cifras (pitch y bend) están en el LCD de arriba,
                así que aquí solo va el fader: se estira para ocupar todo lo
                que sobra y deja los botones de bend abajo del todo, a la
                altura del borde inferior de la pantalla. */}
            <div className="flex flex-1 min-h-0 flex-col items-center">
              {/* Como un plato Technics: arriba más lento (−), abajo más rápido (+) */}
              <Fader
                orientation="vertical"
                min={-pitchRange}
                max={pitchRange}
                step={0.01}
                value={pitchPct}
                onChange={(e) => onPitchChange(e.target.value)}
                fill="center"
                ticks={9}
                invert={true}
                accent="#7dd3fc"
                resetValue={0}
                title={t("pitchFaderTitle")}
                ariaLabel={t("pitch")}
              />
            </div>
            {/* Bend: pulsadores momentáneos. Cuánto estiran se ajusta en
                ⚙ Configuración y se cuenta en el tooltip; en el botón solo va
                el signo. */}
            <div className="flex items-center justify-center gap-1">
              <PadButton
                size="text"
                onMouseDown={() => startBend(-1)}
                onMouseUp={releaseBend}
                onMouseLeave={releaseBend}
                onTouchStart={() => startBend(-1)}
                onTouchEnd={releaseBend}
                title={t("bendMinusTitle")}
              >
                −
              </PadButton>
              <PadButton
                size="text"
                onMouseDown={() => startBend(+1)}
                onMouseUp={releaseBend}
                onMouseLeave={releaseBend}
                onTouchStart={() => startBend(+1)}
                onTouchEnd={releaseBend}
                title={t("bendPlusTitle")}
              >
                +
              </PadButton>
            </div>
          </div>
        </div>
            {/* Transporte */}
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            {/* Un solo botón: en grid reservamos el ancho del texto más
                largo (play/pausa) para que no baile al alternar idioma */}
            <PadButton
              size="transport"
              radius={TRANSPORT_RADIUS}
              skin="none"
              contentClass="grid place-items-center w-full"
              onClick={isPlaying ? pause : play}
              disabled={!objectUrl && !isPlaying}
              className={`min-w-24 text-sm text-black bg-gradient-to-b ${
                isPlaying
                  ? "from-yellow-300 to-yellow-500 border-yellow-400 hover:from-yellow-200 hover:to-yellow-400"
                  : "from-emerald-400 to-emerald-600 border-emerald-500 hover:from-emerald-300 hover:to-emerald-500"
              }`}
            >
              <span className="col-start-1 row-start-1 invisible h-0" aria-hidden>
                {t("play")}
              </span>
              <span className="col-start-1 row-start-1 invisible h-0" aria-hidden>
                {t("pause")}
              </span>
              <span className="col-start-1 row-start-1 whitespace-nowrap">
                {isPlaying ? t("pause") : t("play")}
              </span>
            </PadButton>
            <PadButton
              size="transport"
              radius={TRANSPORT_RADIUS}
              skin="none"
              onClick={stop}
              disabled={!objectUrl}
              className="min-w-24 text-sm text-black border-neutral-300 bg-gradient-to-b from-white to-neutral-300 hover:from-neutral-100 hover:to-neutral-400"
              title={t("stopTitle")}
            >
              {t("stop")}
            </PadButton>
            {/* SYNC y KEY son de encender y apagar: llevan testigo con luz,
                como los de las cajas de abajo. min-w fijo en el SYNC para que
                el texto SYNC·MST no ensanche ni desplace la fila. */}
            <PadButton
              size="transport"
              led
              active={syncActive}
              onClick={() => onSync?.(side)}
              disabled={!canSync || !bpm}
              radius={TRANSPORT_RADIUS}
              className="text-sm min-w-28"
              title={
                syncActive
                  ? t("syncActiveTitle", { source: syncLabel })
                  : t("syncTitle")
              }
            >
              {syncActive ? `${t("sync")}·${syncLabel}` : t("sync")}
            </PadButton>
            <PadButton
              size="transport"
              led
              active={keyLock}
              color="#38bdf8"
              onClick={() => setKeyLock(side, !keyLock)}
              disabled={!objectUrl}
              radius={TRANSPORT_RADIUS}
              className="text-xs"
              title={t("keyLockTitle")}
            >
              {t("keyLock")}
            </PadButton>
          </div>
        {/* Herramientas del deck, por pestañas.
              Antes eran tres filas de cajas y se comían media tarjeta. Cada
              pestaña enseña UN grupo, en el orden de siempre, y el panel
              tiene alto fijo: cambiar de pestaña no mueve nada de sitio. */}
          <div className="pt-3 border-t border-neutral-800/70">
            <div role="tablist" className="flex gap-0.5 overflow-x-auto">
              {TOOL_TABS.map((tb) => (
                <button
                  key={tb.id}
                  role="tab"
                  aria-selected={tool === tb.id}
                  onClick={() => setTool(tb.id)}
                  className={`px-2 py-1 text-[9px] font-semibold uppercase tracking-wide whitespace-nowrap border-b-2 -mb-px ${
                    tool === tb.id
                      ? "border-emerald-400 text-neutral-100"
                      : "border-transparent text-neutral-500 hover:text-neutral-300"
                  }`}
                >
                  {t(tb.labelKey)}
                </button>
              ))}
            </div>
            {/* Alto fijo: el deck mide lo mismo en todas las pestañas.
                `relative` porque el editor de nombre flota sobre el panel. */}
            <div className="relative mt-1 flex min-h-[5.25rem] flex-wrap items-stretch gap-2 rounded-lg border border-neutral-800 bg-neutral-900/40 p-1.5 text-xs">
              {tool === "position" && (
                <PositionTools
                  objectUrl={objectUrl}
                  bpm={bpm}
                  hotCues={hotCues}
                  triggerHotCue={triggerHotCue}
                  clearHotCue={clearHotCue}
                  renameHotCue={renameHotCue}
                  naming={naming}
                  setNaming={setNaming}
                  jumpBeats={jumpBeats}
                  setJumpBeats={setJumpBeats}
                  beatJump={beatJump}
                />
              )}
              {tool === "bpm" && (
                <BpmTools
                  objectUrl={objectUrl}
                  bpm={bpm}
                  analyzing={analyzing}
                  quantize={quantize}
                  setQuantize={setQuantize}
                  onTapBeat={onTapBeat}
                  scaleGrid={scaleGrid}
                  regridFromManual={regridFromManual}
                  nudgeGrid={nudgeGrid}
                  stretchGrid={stretchGrid}
                  structure={structure}
                  phraseSize={phraseSize}
                  onPhraseSize={onPhraseSize}
                  shiftPhrase={shiftPhrase}
                  redetectStructure={redetectStructure}
                  resetPhrase={resetPhrase}
                  bandLow={bandLow}
                  beats={beats}
                />
              )}
              {tool === "loops" && (
                <LoopTools
                  objectUrl={objectUrl}
                  bpm={bpm}
                  loopIn={loopIn}
                  loopOut={loopOut}
                  loopOn={loopOn}
                  loopLabel={loopLabel}
                  setLoopInNow={setLoopInNow}
                  setLoopOutNow={setLoopOutNow}
                  toggleLoop={toggleLoop}
                  autoLoop={autoLoop}
                  moveLoopBy={moveLoopBy}
                  resizeLoopBy={resizeLoopBy}
                  savedLoops={savedLoops}
                  savedLoopIdx={savedLoopIdx}
                  setSavedLoopIdx={setSavedLoopIdx}
                  saveCurrentLoop={saveCurrentLoop}
                  recallSavedLoop={recallSavedLoop}
                  deleteSavedLoop={deleteSavedLoop}
                  renameSavedLoop={renameSavedLoop}
                  naming={naming}
                  setNaming={setNaming}
                  rolling={rolling}
                  startRoll={startRoll}
                  endRoll={endRoll}
                />
              )}              </div>
          </div>
        <audio
          ref={audioRef}
          className="hidden"
          preload="metadata"
          crossOrigin="anonymous"
        />
      </div>
    </div>
  );
}

export default memo(Deck);

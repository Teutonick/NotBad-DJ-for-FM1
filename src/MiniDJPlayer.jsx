import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioEngine } from "./audio/engine";
import { PITCH_RANGES } from "./lib/constants";
import Deck from "./components/Deck";
import CentralMeters from "./components/CentralMeters";
import Mixer from "./components/Mixer";
import TrackList from "./components/TrackList";
import HeadphoneCue from "./components/HeadphoneCue";
import ConfigDialog from "./components/ConfigDialog";
import UpdateToast from "./components/UpdateToast";
import { useI18n } from "./i18n/context";
import { useDeckShortcuts } from "./hooks/useDeckShortcuts";
import { useTrackLibrary } from "./hooks/useTrackLibrary";
import {
  withCues,
  withDeckMeta,
  withGrid,
  withPlayed,
  withStructure,
} from "./lib/trackRules";
import { loadConfig, resolveConfig, saveConfig } from "./lib/config";
import { canSync, computeSyncPitch, syncTargetBpm } from "./lib/sync";
import { buildWavePalette, resolveWaveColors } from "./lib/waveColors";
import { resolveStructurePrefs } from "./lib/structurePrefs";
import { sanitizeStructure } from "./audio/structure";
import { ERRORS, logError } from "./lib/log";

export default function MiniDJMixer() {
  const { t } = useI18n();
  const engine = useMemo(() => new AudioEngine(), []);

  const [master, setMaster] = useState(1);
  const [volA, setVolA] = useState(1);
  const [volB, setVolB] = useState(1);
  const [eqA, setEqA] = useState({ gain: 0, high: 0, mid: 0, low: 0 });
  const [eqB, setEqB] = useState({ gain: 0, high: 0, mid: 0, low: 0 });

  // Centralizamos pitch y BPM para SYNC
  const [pitchPctA, setPitchPctA] = useState(0);
  const [pitchPctB, setPitchPctB] = useState(0);
  const [bpms, setBpms] = useState({ A: null, B: null });

  // Sync continuo por deck + master sync global
  const [syncOn, setSyncOn] = useState({ A: false, B: false });
  const [masterSyncOn, setMasterSyncOn] = useState(false);
  const [masterBpm, setMasterBpm] = useState(128);

  // Rango y key lock por deck
  const [rangeA, setRangeA] = useState(8);
  const [rangeB, setRangeB] = useState(8);
  const [keyLockA, setKeyLockA] = useState(false);
  const [keyLockB, setKeyLockB] = useState(false);

  const [deckAutoGain, setDeckAutoGain] = useState({ A: 0, B: 0 });

  // Pista cargada en cada deck (la lista vive en useTrackLibrary, más abajo)
  const [deckTracks, setDeckTracks] = useState({ A: null, B: null });
  const deckTracksRef = useRef(deckTracks);
  useEffect(() => {
    deckTracksRef.current = deckTracks;
  }, [deckTracks]);

  // Onda + beats por deck (para el panel de beat-match)
  const [deckAnalysis, setDeckAnalysis] = useState({ A: null, B: null });

  // Tonalidad y estado de reproducción por deck: con esto la lista sabe con
  // qué pista comparar las compatibilidades armónicas
  const [deckKeys, setDeckKeys] = useState({ A: null, B: null });
  const [playing, setPlaying] = useState({ A: false, B: false });
  const [lastStarted, setLastStarted] = useState("A");
  // Espejo en ref del estado de reproducción: lo consulta el guardián de
  // carga sin que cambie la identidad de onLoadToDeck (TrackList es memo)
  const playingRef = useRef(playing);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  // Deck activo: recibe los atajos de teclado
  const [activeDeck, setActiveDeck] = useState("A");
  const deckRefs = useRef({ A: null, B: null });
  const setDeckRefA = useCallback((api) => {
    deckRefs.current.A = api;
  }, []);
  const setDeckRefB = useCallback((api) => {
    deckRefs.current.B = api;
  }, []);
  const audioElsRef = useRef({ A: null, B: null });

  // Salidas dedicadas por deck (modo mezcla externa)
  const deckOutARef = useRef(null);
  const deckOutBRef = useRef(null);

  // Configuración persistente (salidas de audio, modo de análisis)
  const [config, setConfig] = useState(() => loadConfig());
  const [showConfig, setShowConfig] = useState(false);
  // Valores efectivos (con sus valores de fábrica): los mismos que enseña ⚙
  const settings = useMemo(() => resolveConfig(config), [config]);

  // Bloqueo de carga sobre un deck en reproducción (activado por defecto)
  const lockLoadWhilePlaying = settings.lockLoadWhilePlaying;
  const lockLoadRef = useRef(lockLoadWhilePlaying);
  lockLoadRef.current = lockLoadWhilePlaying;

  // Modo de visualización de los VU: LED por defecto, como una mesa de verdad
  const vuMode = settings.vuMode;

  // Rango del fader de pitch y cuánto estira el bend: se ajustan en ⚙ y valen
  // para los dos decks. El rango es el de PARTIDA: el sync puede ensancharlo
  // por su cuenta si necesita más recorrido, y eso no toca la configuración.
  const configPitchRange = settings.pitchRange;
  const bendRange = settings.bendRange;

  useEffect(() => {
    setRangeA(configPitchRange);
    setRangeB(configPitchRange);
    setPitchPctA((p) => Math.max(-configPitchRange, Math.min(configPitchRange, p)));
    setPitchPctB((p) => Math.max(-configPitchRange, Math.min(configPitchRange, p)));
  }, [configPitchRange]);

  useEffect(() => saveConfig(config), [config]);

  // Lista de canciones (crate): persistencia en IndexedDB y análisis de fondo
  const { tracks, updateTrack, addTracks, removeTrack } = useTrackLibrary({
    analysisMode: settings.analysisMode,
  });

  useEffect(() => {
    engine.setMaster(master);
  }, [engine, master]);

  useEffect(() => {
    engine.setDeckVolume("A", volA);
  }, [engine, volA]);
  useEffect(() => {
    engine.setDeckVolume("B", volB);
  }, [engine, volB]);

  // === Aplicar salidas de audio de la config ===
  useEffect(() => {
    if (typeof engine.ctx.setSinkId !== "function") return;
    engine.setMasterSink(config.masterOut || "").catch((err) => {
      logError(ERRORS.AUDIO_SINK_MASTER, err, {
        deviceId: config.masterOut || "(default)",
      });
    });
  }, [engine, config.masterOut]);

  const applyDeckOutput = useCallback(
    (side, deviceId, elRef) => {
      const el = elRef.current;
      if (deviceId) {
        engine.setDeckOutput(side, true);
        if (el) {
          if (!el.srcObject) el.srcObject = engine.getDeckStream(side);
          el.setSinkId?.(deviceId).catch((err) =>
            logError(ERRORS.AUDIO_SINK_DECK, err, { deck: side, deviceId })
          );
          el.play().catch(() => {});
        }
      } else {
        engine.setDeckOutput(side, false);
        el?.pause();
      }
    },
    [engine]
  );

  useEffect(() => {
    applyDeckOutput("A", config.deckAOut, deckOutARef);
  }, [applyDeckOutput, config.deckAOut]);
  useEffect(() => {
    applyDeckOutput("B", config.deckBOut, deckOutBRef);
  }, [applyDeckOutput, config.deckBOut]);

  const onAttachEl = useCallback(
    (which, el) => {
      audioElsRef.current[which] = el;
      engine.attachMediaElement(which, el);
    },
    [engine]
  );

  const onVolChange = useCallback((which, v) => {
    if (which === "A") setVolA(v);
    else setVolB(v);
  }, []);

  // El Mixer aplica el EQ efectivo al grafo (incluye los kills de banda)
  const setEq = useCallback((which, vals) => {
    if (which === "A") setEqA(vals);
    else setEqB(vals);
  }, []);

  const setPitchRange = useCallback((which, r) => {
    if (which === "A") setRangeA(r);
    else setRangeB(r);
  }, []);

  const setKeyLock = useCallback((which, val) => {
    if (which === "A") setKeyLockA(val);
    else setKeyLockB(val);
  }, []);

  const setPitchPct = useCallback((which, v) => {
    if (which === "A") setPitchPctA(v);
    else setPitchPctB(v);
  }, []);

  // Rejilla de un deck (detectada o ajustada a mano): alimenta el SYNC y, si
  // la pista vino de la lista, se guarda para no perder el ajuste al recargar
  const onBpmDetected = useCallback((side, bpm, grid) => {
    setBpms((prev) => (prev[side] === bpm ? prev : { ...prev, [side]: bpm }));
    if (!bpm) return;
    const loaded = deckTracksRef.current[side];
    if (!loaded) return;
    const dur = audioElsRef.current[side]?.duration;
    const anchor = Number.isFinite(grid?.anchor) ? grid.anchor : null;
    const manual = Boolean(grid?.manual);
    updateTrack(loaded.id, (t) => withGrid(t, { bpm, anchor, manual, duration: dur }));
  }, [updateTrack]);

  // Datos que llegan del deck (etiquetas al cargar, tonalidad al analizar):
  // se reflejan en la lista y se persisten para no repetir el trabajo
  const onTrackMeta = useCallback((side, data) => {
    if ("musicalKey" in data) {
      setDeckKeys((prev) =>
        prev[side] === data.musicalKey ? prev : { ...prev, [side]: data.musicalKey }
      );
    }
    const loaded = deckTracksRef.current[side];
    if (!loaded) return;
    updateTrack(loaded.id, (t) => withDeckMeta(t, data));
  }, [updateTrack]);

  // Hot cues y loops que llegan del deck. Son del USUARIO: se guardan tal cual
  // en la fila de la pista y ningún análisis los vuelve a tocar. Solo se
  // escribe cuando algo ha cambiado de verdad, que esto viaja a IndexedDB.
  const onCues = useCallback((side, data) => {
    const loaded = deckTracksRef.current[side];
    if (!loaded) return;
    updateTrack(loaded.id, (t) => withCues(t, data));
  }, [updateTrack]);

  // Estructura de la pista analizada en el deck: se guarda en su fila para no
  // volver a calcularla nunca más. Lo que el usuario haya ajustado a mano
  // (structure.manual) viaja dentro y el análisis de fondo no lo toca.
  const onStructure = useCallback((side, structure) => {
    const loaded = deckTracksRef.current[side];
    if (!loaded) return;
    const clean = sanitizeStructure(structure);
    if (!clean) return;
    updateTrack(loaded.id, (t) => withStructure(t, clean));
  }, [updateTrack]);

  // Tamaño de frase: el selector rápido del deck y el del diálogo ⚙ son el
  // MISMO ajuste visto desde dos sitios.
  const onPhraseSize = useCallback((n) => {
    setConfig((prev) => ({ ...prev, phraseSize: n }));
  }, []);

  // Pista cargada desde el propio deck (📂): ya no es la de la lista, así que
  // se suelta el vínculo y su BPM y sus cues no acaban en la fila de otra.
  const onLocalLoad = useCallback((side) => {
    setDeckTracks((prev) => (prev[side] ? { ...prev, [side]: null } : prev));
  }, []);

  const onPlayingChange = useCallback((side, isPlaying) => {
    setPlaying((prev) => (prev[side] === isPlaying ? prev : { ...prev, [side]: isPlaying }));
    if (isPlaying) setLastStarted(side);
  }, []);

  const onAnalysis = useCallback((side, data) => {
    setDeckAnalysis((prev) => ({
      ...prev,
      [side]: { ...prev[side], ...data },
    }));
  }, []);

  // Marcar en la lista que la pista ya se pinchó en ese deck
  const onPlayed = useCallback((side) => {
    const loaded = deckTracksRef.current[side];
    if (!loaded) return;
    updateTrack(loaded.id, (t) => withPlayed(t, side));
  }, [updateTrack]);

  // SYNC continuo: alterna el modo sync del deck
  const onSync = useCallback((side) => {
    setSyncOn((prev) => ({ ...prev, [side]: !prev[side] }));
  }, []);

  const onAutoGainComputed = useCallback((side, gainDb) => {
    setDeckAutoGain((prev) => ({ ...prev, [side]: gainDb }));
  }, []);

  // useCallback: CentralMeters es memo y un callback nuevo en cada render lo
  // repintaba con cada movimiento de fader
  const onToggleMasterSync = useCallback(() => {
    setMasterSyncOn((prev) => {
      const next = !prev;
      if (next) {
        // Al activarlo, parte del BPM efectivo actual de un deck si lo hay
        const effA = bpms.A ? bpms.A * (1 + pitchPctA / 100) : null;
        const effB = bpms.B ? bpms.B * (1 + pitchPctB / 100) : null;
        const init = effA ?? effB;
        if (init) setMasterBpm(Math.round(init));
      }
      return next;
    });
  }, [bpms, pitchPctA, pitchPctB]);

  const onOpenConfig = useCallback(() => setShowConfig(true), []);
  const onToggleArtwork = useCallback(
    (v) => setConfig((prev) => ({ ...prev, showArtwork: v })),
    []
  );

  // Motor de sync: mientras un deck tenga SYNC, su pitch se ajusta solo al
  // objetivo (master BPM o BPM efectivo del otro deck)
  useEffect(() => {
    const state = {
      bpms,
      pitch: { A: pitchPctA, B: pitchPctB },
      masterSyncOn,
      masterBpm,
    };
    ["A", "B"].forEach((side) => {
      if (!syncOn[side]) return;
      const own = bpms[side];
      if (!own) return;
      const targetBpm = syncTargetBpm(side, state);
      if (!targetBpm) return;

      const currentRange = side === "A" ? rangeA : rangeB;
      const { pitch, range } = computeSyncPitch({
        ownBpm: own,
        targetBpm,
        currentRange,
        ranges: PITCH_RANGES,
      });

      const cur = side === "A" ? pitchPctA : pitchPctB;
      if (range !== currentRange) setPitchRange(side, range);
      if (Math.abs(pitch - cur) > 0.005) setPitchPct(side, pitch);
    });
  }, [
    syncOn,
    masterSyncOn,
    masterBpm,
    bpms,
    pitchPctA,
    pitchPctB,
    rangeA,
    rangeB,
    setPitchPct,
    setPitchRange,
  ]);

  // Guardián de carga: con el bloqueo puesto, un deck que está sonando no
  // admite otra pista. Los botones ya salen deshabilitados, pero esto cierra
  // la puerta también a atajos y a cualquier vía futura.
  const onLoadToDeck = useCallback(
    (side, track) => {
      if (lockLoadRef.current && playingRef.current[side]) return;
      setDeckTracks((prev) => ({
        ...prev,
        [side]: { ...track, loadToken: (prev[side]?.loadToken || 0) + 1 },
      }));
    },
    []
  );

  // === Atajos de teclado (actúan sobre el deck activo) ===
  // Con ⚙ abierto no: Espacio tiene que activar la pestaña con el foco, no
  // poner la pista en marcha detrás del diálogo.
  useDeckShortcuts({ deckRefs, activeDeck, setActiveDeck, suspended: showConfig });

  const syncLabel = (side) =>
    masterSyncOn ? "MST" : side === "A" ? "B" : "A";
  const canSyncFor = (side) => canSync(side, { bpms, masterSyncOn });

  // Tonalidad de referencia para la lista: la del deck que esté sonando (si
  // suenan los dos, la del último que arrancó)
  const referenceKey = useMemo(() => {
    const order = lastStarted === "B" ? ["B", "A"] : ["A", "B"];
    for (const side of order) {
      if (playing[side] && deckKeys[side]) return deckKeys[side];
    }
    return null;
  }, [playing, deckKeys, lastStarted]);

  // Ajustes del indicador de estructura y del aviso de fin de pista
  const structurePrefs = useMemo(() => resolveStructurePrefs(config), [config]);

  // Paleta de la onda: se reconstruye solo al cambiar de preset o de color
  const wavePalette = useMemo(
    () => buildWavePalette(resolveWaveColors(config)),
    [config]
  );

  const eqPair = useMemo(() => ({ A: eqA, B: eqB }), [eqA, eqB]);
  const volPair = useMemo(() => ({ A: volA, B: volB }), [volA, volB]);

  return (
    <div className="min-h-screen w-full bg-neutral-950 text-neutral-100 p-3 sm:p-6">
      <div className="mx-auto grid gap-4 sm:gap-6">
        {/* Cabecera: título + REC | beat match | master + master sync */}
        <CentralMeters
          engine={engine}
          master={master}
          setMaster={setMaster}
          analysis={deckAnalysis}
          audioElsRef={audioElsRef}
          masterSyncOn={masterSyncOn}
          onToggleMasterSync={onToggleMasterSync}
          masterBpm={masterBpm}
          setMasterBpm={setMasterBpm}
          onOpenConfig={onOpenConfig}
          vuMode={vuMode}
        />

        {/* Decks */}
        {/* El mixer ocupa lo que necesita y los dos decks se reparten el
            resto a partes iguales. Con tres columnas iguales, la fila de
            herramientas del deck se quedaba en 458 px y las cajas de arriba
            (hot cues + rejilla + estructura) no cabían en una línea. */}
        <div className="grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-4 sm:gap-6 [&>*]:min-w-0">
          <Deck
            ref={setDeckRefA}
            colorClass="from-cyan-500/20 to-transparent"
            engine={engine}
            side="A"
            vol={volA}
            onVolChange={onVolChange}
            eq={eqA}
            setEq={setEq}
            pitchPct={pitchPctA}
            setPitchPct={setPitchPct}
            pitchRange={rangeA}
            bendRange={bendRange}
            keyLock={keyLockA}
            setKeyLock={setKeyLock}
            onAttachEl={onAttachEl}
            onBpmDetected={onBpmDetected}
            onAnalysis={onAnalysis}
            onSync={onSync}
            canSync={canSyncFor("A")}
            syncActive={syncOn.A}
            syncLabel={syncLabel("A")}
            onPlayed={onPlayed}
            onPlayingChange={onPlayingChange}
            onTrackMeta={onTrackMeta}
            onCues={onCues}
            onStructure={onStructure}
            onPhraseSize={onPhraseSize}
            structurePrefs={structurePrefs}
            showKey={settings.showKey}
            onLocalLoad={onLocalLoad}
            wavePalette={wavePalette}
            externalTrack={deckTracks.A}
            isActive={activeDeck === "A"}
            onActivate={setActiveDeck}
            onAutoGainComputed={onAutoGainComputed}
            lockLoadWhilePlaying={lockLoadWhilePlaying}
          />
          <Mixer
            engine={engine}
            eq={eqPair}
            setEq={setEq}
            vol={volPair}
            onVolChange={onVolChange}
            deckAutoGain={deckAutoGain}
            vuMode={vuMode}
          />
          <Deck
            ref={setDeckRefB}
            colorClass="from-fuchsia-500/20 to-transparent"
            engine={engine}
            side="B"
            vol={volB}
            onVolChange={onVolChange}
            eq={eqB}
            setEq={setEq}
            pitchPct={pitchPctB}
            setPitchPct={setPitchPct}
            pitchRange={rangeB}
            bendRange={bendRange}
            keyLock={keyLockB}
            setKeyLock={setKeyLock}
            onAttachEl={onAttachEl}
            onBpmDetected={onBpmDetected}
            onAnalysis={onAnalysis}
            onSync={onSync}
            canSync={canSyncFor("B")}
            syncActive={syncOn.B}
            syncLabel={syncLabel("B")}
            onPlayed={onPlayed}
            onPlayingChange={onPlayingChange}
            onTrackMeta={onTrackMeta}
            onCues={onCues}
            onStructure={onStructure}
            onPhraseSize={onPhraseSize}
            structurePrefs={structurePrefs}
            showKey={settings.showKey}
            onLocalLoad={onLocalLoad}
            wavePalette={wavePalette}
            externalTrack={deckTracks.B}
            isActive={activeDeck === "B"}
            onActivate={setActiveDeck}
            onAutoGainComputed={onAutoGainComputed}
            lockLoadWhilePlaying={lockLoadWhilePlaying}
          />
        </div>

        {/* Pre-escucha */}
        <HeadphoneCue engine={engine} cueDeviceId={config.cueOut} />

        {/* Lista de canciones */}
        <TrackList
          tracks={tracks}
          deckTracks={deckTracks}
          onAddTracks={addTracks}
          onLoadToDeck={onLoadToDeck}
          onRemoveTrack={removeTrack}
          referenceKey={referenceKey}
          showArtwork={settings.showArtwork}
          showKey={settings.showKey}
          onToggleArtwork={onToggleArtwork}
          playing={playing}
          lockLoadWhilePlaying={lockLoadWhilePlaying}
        />

        {/* Atajos */}
        <p className="text-[10px] text-neutral-600 text-center">
          {t("shortcuts")}
        </p>
      </div>

      {/* Salidas dedicadas por deck (modo mezcla externa) */}
      <audio ref={deckOutARef} className="hidden" />
      <audio ref={deckOutBRef} className="hidden" />

      <ConfigDialog
        open={showConfig}
        onClose={() => setShowConfig(false)}
        config={config}
        onConfigChange={setConfig}
      />

      {/* Aviso de actualización: no pinta nada fuera de la app de escritorio */}
      <UpdateToast />
    </div>
  );
}

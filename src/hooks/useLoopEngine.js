import { useEffect, useRef, useState } from "react";
import {
  autoLoop as computeAutoLoop,
  beatsLabel,
  loopLengthBeats,
  moveLoop,
  resizeLoop,
  rollExitTime,
  rollLoop,
  wrapTime,
} from "../audio/loops";

// Tramo final antes del OUT que se apura con ticks cortos
const FINE_MS = 12;

// === Loop activo de un deck: región, roll y el motor que salta ===
//
// - `applyLoop(region, on)` es el punto ÚNICO por el que pasan los cambios de
//   región completos: así la longitud en beats y el motor del salto no se
//   desincronizan nunca.
// - Con IN/OUT a mano la longitud en beats (`loopBeats`) es null y las
//   cuentas van en segundos; con loops automáticos, roll, doblar o partir se
//   conoce y se conserva.
// - El roll es momentáneo: mientras dura, el loop activo es el suyo y el que
//   hubiera antes espera para volver al soltar. Al soltar, la pista sigue
//   DONDE ESTARÍA si el roll no hubiera ocurrido (rollExitTime).
// - Comprobar la posición una vez por frame deja 17 ms de margen: en un loop
//   de 1/8 de beat (≈59 ms a 128 BPM) eso es casi un tercio de su longitud y
//   el tropiezo se oye. Por eso el motor programa un temporizador para el
//   instante del salto y solo hila fino en los últimos milisegundos. El
//   retraso que quede se ARRASTRA al punto de entrada (wrapTime): el bucle
//   mantiene la fase aunque el aviso llegue tarde.
//
// Lo que necesita del deck: el <audio>, si hay pista (`loaded`), la rejilla
// (bpm, beats, ancla y duración), el quantize y `setCurrent`, para que la UI
// vea la posición nueva en cuanto se mueve el playhead.
export function useLoopEngine({
  audioRef,
  loaded,
  bpm,
  beats,
  gridAnchor,
  duration,
  quantize,
  snapToGrid,
  setCurrent,
}) {
  const [loopIn, setLoopIn] = useState(null);
  const [loopOut, setLoopOut] = useState(null);
  const [loopOn, setLoopOn] = useState(false);
  const [loopBeats, setLoopBeats] = useState(null);
  // Roll en curso: { beats }
  const [rolling, setRolling] = useState(null);
  // { prev: loop de antes del roll, length } mientras se mantiene un roll
  const rollRef = useRef(null);

  const seek = (el, time) => {
    el.currentTime = time;
    setCurrent(time);
  };

  const applyLoop = (region, on) => {
    setLoopIn(region?.start ?? null);
    setLoopOut(region?.end ?? null);
    setLoopBeats(region?.beats ?? null);
    setLoopOn(Boolean(region && on));
  };

  // Al cargar otra pista: su último loop vuelve donde estaba, pero APAGADO
  // (nadie espera que empiece a dar vueltas sola), y un roll que se estuviera
  // manteniendo se olvida.
  const resetLoop = (region) => {
    rollRef.current = null;
    setRolling(null);
    applyLoop(region, false);
  };

  const setLoopInNow = () => {
    const el = audioRef.current;
    if (!el || !loaded) return;
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

  const turnLoopOff = () => setLoopOn(false);

  // Loop automático de N beats anclado al beat anterior más cercano
  const autoLoop = (nBeats) => {
    const el = audioRef.current;
    if (!el || !loaded) return;
    const region = computeAutoLoop({
      bpm,
      beats,
      time: el.currentTime || 0,
      lengthBeats: nBeats,
      duration,
    });
    if (region) applyLoop(region, true);
  };

  // Mueve el loop entero una longitud hacia delante o hacia atrás. Si está
  // sonando dentro, el playhead se mueve con él y conserva su sitio relativo.
  const moveLoopBy = (dir) => {
    if (loopIn == null || loopOut == null) return;
    const next = moveLoop({ start: loopIn, end: loopOut, dir, duration });
    if (!next) return;
    const el = audioRef.current;
    const cur = el?.currentTime ?? null;
    setLoopIn(next.start);
    setLoopOut(next.end);
    if (el && loopOn && cur != null && cur >= loopIn && cur <= loopOut) {
      seek(el, next.start + (cur - loopIn));
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
      duration,
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
        seek(el, wrapTime({ current: cur, start: next.start, end: next.end }));
      }
    }
  };

  // === Motor ===
  const loopRef = useRef({ on: false, start: 0, end: 0, wraps: 0, gen: 0 });
  const loopActive = loopOn && loopIn != null && loopOut != null;
  {
    // Se actualiza en el render, no en un efecto: el temporizador que ya está
    // armado tiene que ver la región nueva antes de su próximo tick.
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
        const to = wrapTime({ current: now, start: st.start, end: st.end });
        el.currentTime = to;
        // Si el aviso llegó tarde más de una vuelta (hilo principal ocupado),
        // el salto retrocede varias longitudes de golpe: se cuentan todas, o
        // al soltar un roll la pista saldría vueltas enteras por detrás.
        const len = st.end - st.start;
        st.wraps += len > 0 ? Math.max(1, Math.round((now - to) / len)) : 1;
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
  }, [audioRef, loopActive, loopIn, loopOut]);

  // === Roll ===
  const startRoll = (lengthBeats) => {
    const el = audioRef.current;
    if (!el || !loaded || rollRef.current) return;
    const region = rollLoop({
      bpm,
      gridAnchor,
      time: el.currentTime || 0,
      lengthBeats,
      quantize,
      duration,
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
      seek(
        el,
        rollExitTime({
          current: el.currentTime || 0,
          wraps: loopRef.current.wraps,
          loopLength: st.length,
          duration: duration || el.duration || 0,
        })
      );
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

  // Longitud del loop para la UI: en beats cuando cuadra con la rejilla, en
  // segundos cuando el IN/OUT se puso a mano fuera de ella.
  const loopLabel =
    loopIn != null && loopOut != null
      ? loopBeats
        ? `${beatsLabel(loopBeats)} ♪`
        : `${(loopOut - loopIn).toFixed(2)} s`
      : "—";

  return {
    loopIn,
    loopOut,
    loopOn,
    loopBeats,
    loopLabel,
    rolling,
    applyLoop,
    resetLoop,
    setLoopInNow,
    setLoopOutNow,
    toggleLoop,
    turnLoopOff,
    autoLoop,
    moveLoopBy,
    resizeLoopBy,
    startRoll,
    endRoll,
  };
}

// Montaje de un Deck para tests de DOM, con un <audio> de mentira que avanza
// solo: currentTime sigue el reloj real mientras «suena» (play/pause de
// verdad, a su playbackRate), y cada vez que alguien lo mueve queda apuntado
// en `audio.saltos` con dónde estaba y a dónde fue. «Dónde estaba» es lo
// último que LEYÓ el código antes de escribir: con eso calculó el salto, y
// así la comparación no depende de lo cargada que vaya la máquina. Es lo que hace falta para
// ver al motor del loop saltar con sus temporizadores, sin AudioContext.
//
// Los mocks de módulos (onda, detector, etiquetas) no pueden ir aquí: vi.mock
// solo vale en el propio fichero de test. Cada test de deck los declara.
import { createRef } from "react";
import { expect, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import Deck from "../../src/components/Deck";
import { renderWithI18n, t } from "./render.jsx";
import { makeAudioBuffer, sine } from "./signals";

const SR = 8000;

export const pista = (nombre = "tema.mp3") =>
  new File([new Uint8Array(2048)], nombre, { type: "audio/mpeg" });

// Estado del <audio> falso (uno para todos los <audio> del documento: los
// tests montan un deck cada vez)
export const audio = {
  base: 0, // posición al último play/pause/salto
  desde: null, // performance.now() del último play; null = parado
  rate: 1,
  saltos: [], // { antes, despues } cada vez que se escribe currentTime
  leido: null, // lo último que devolvió currentTime
};

const ahora = () =>
  audio.desde == null
    ? audio.base
    : audio.base + ((performance.now() - audio.desde) / 1000) * audio.rate;

// Pone la pista en un sitio sin contarlo como salto (lo que haría el usuario
// con la onda, o simplemente «estar ahí»)
export const ponerEn = (t) => {
  audio.base = t;
  if (audio.desde != null) audio.desde = performance.now();
};

export const posicion = ahora;
export const sonando = () => audio.desde != null;

export function instalarAudioFalso({ seconds = 30 } = {}) {
  audio.base = 0;
  audio.desde = null;
  audio.rate = 1;
  audio.saltos = [];
  audio.leido = null;
  const decodeAudioData = vi.fn(async () =>
    makeAudioBuffer([sine({ seconds, amp: 0.5, sampleRate: SR })], SR),
  );
  URL.createObjectURL = vi.fn(() => "blob:mini-dj/1");
  URL.revokeObjectURL = vi.fn();
  const proto = HTMLMediaElement.prototype;
  // Como el de verdad: cargar otra fuente para y vuelve al principio
  proto.load = vi.fn(() => {
    audio.base = 0;
    audio.desde = null;
  });
  proto.play = vi.fn(async () => {
    if (audio.desde == null) audio.desde = performance.now();
  });
  proto.pause = vi.fn(() => {
    audio.base = ahora();
    audio.desde = null;
  });
  Object.defineProperty(proto, "currentTime", {
    configurable: true,
    get: () => (audio.leido = ahora()),
    set: (v) => {
      audio.saltos.push({ antes: audio.leido ?? ahora(), despues: v });
      ponerEn(v);
    },
  });
  Object.defineProperty(proto, "playbackRate", {
    configurable: true,
    get: () => audio.rate,
    set: (v) => {
      audio.base = ahora();
      if (audio.desde != null) audio.desde = performance.now();
      audio.rate = v;
    },
  });
  Object.defineProperty(proto, "paused", {
    configurable: true,
    get: () => audio.desde == null,
  });
  Object.defineProperty(proto, "duration", {
    configurable: true,
    get: () => seconds,
  });
  return {
    motor: () => ({ ctx: { decodeAudioData }, resume: vi.fn(async () => {}) }),
    decodeAudioData,
  };
}

export const deckEl = ({ motor, file, token = 1, track, ...props }) => (
  <Deck
    colorClass=""
    engine={motor()}
    side="A"
    pitchPct={0}
    setPitchPct={() => {}}
    pitchRange={8}
    setPitchRange={() => {}}
    keyLock={false}
    setKeyLock={() => {}}
    onAttachEl={() => {}}
    onAutoGainComputed={() => {}}
    onBpmDetected={() => {}}
    onAnalysis={() => {}}
    onSync={() => {}}
    canSync={false}
    syncActive={false}
    syncLabel=""
    onPlayed={() => {}}
    onPlayingChange={() => {}}
    onTrackMeta={() => {}}
    wavePalette={[]}
    externalTrack={file ? { file, loadToken: token, ...track } : null}
    isActive={false}
    onActivate={() => {}}
    lockLoadWhilePlaying
    {...props}
  />
);

// Espera a que el deck montado en `container` tenga la pista cargada: el pad 1
// de hot cue (pestaña Posición, la que abre por defecto) se puede pulsar, o
// sea, React ya tiene el objectUrl. El `src` del <audio> NO vale: se escribe
// directamente un instante antes, y con la máquina cargada el test empezaba
// en ese hueco y las acciones no hacían nada.
export async function esperarCargada(container) {
  await waitFor(() => {
    const pad = container.querySelector(
      `button[title="${t("hotCueSetTitle", { n: 1 })}"], button[title^="Hot cue 1:"]`,
    );
    expect(pad).not.toBeNull();
    expect(pad).not.toBeDisabled();
  });
}

// Monta el deck con una pista y espera a que esté cargada. Devuelve también la
// API de los atajos (`api`), que es la misma que usan las teclas: loopIn,
// loopOut, rollStart…
export async function montarDeck(opts) {
  const ref = createRef();
  const props = { file: pista(), ...opts, ref };
  const utils = renderWithI18n(deckEl(props));
  await esperarCargada(utils.container);
  return { ...utils, api: () => ref.current, props };
}

// Espera real (el motor del loop usa temporizadores de verdad)
export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Configuración persistente de la app (lo que se toca en ⚙).
//
// Un único objeto en localStorage ("mini-dj-config"). Aquí está cómo se lee,
// cómo se guarda y qué vale cada ajuste cuando falta o es imposible, para que
// la app y el diálogo lean exactamente lo mismo: antes cada uno validaba por su
// cuenta, y con un valor raro guardado la app usaba uno y el diálogo no marcaba
// ninguno. Los ajustes de la estructura y de la onda tienen su propio
// resolutor (structurePrefs.js, waveColors.js) sobre este mismo objeto.

import {
  BEND_RANGES,
  DEFAULT_BEND_RANGE,
  DEFAULT_PITCH_RANGE,
  PITCH_RANGES,
} from "./constants";

export const CONFIG_KEY = "mini-dj-config";

export const VU_MODES = ["led", "continuous"];
export const ANALYSIS_MODES = ["auto", "deck"];

const defaultStorage = () =>
  typeof localStorage !== "undefined" ? localStorage : null;

/** Lo guardado, o {} si no hay nada, no es un objeto o no hay almacenamiento. */
export function loadConfig(storage = defaultStorage()) {
  try {
    const parsed = JSON.parse(storage?.getItem(CONFIG_KEY) ?? "null");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

export function saveConfig(config, storage = defaultStorage()) {
  try {
    storage?.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    // almacenamiento no disponible o sin cuota: se sigue con lo de memoria
  }
}

/**
 * `value` si está en `list`; si no, `fallback`. En listas de números acepta
 * el número escrito como texto (un <select> devuelve cadenas).
 */
export function pickOption(list, value, fallback) {
  if (typeof list[0] === "number") {
    // Number(), como se hacía antes en cada sitio: null y "" valen 0
    const n = Number(value);
    return list.includes(n) ? n : fallback;
  }
  return list.includes(value) ? value : fallback;
}

/** Ajustes efectivos de la app a partir de la config guardada. */
export function resolveConfig(config = {}) {
  return {
    // Rango de PARTIDA del fader de pitch: el sync lo ensancha por su cuenta
    pitchRange: pickOption(
      PITCH_RANGES,
      config.pitchRange,
      DEFAULT_PITCH_RANGE,
    ),
    bendRange: pickOption(BEND_RANGES, config.bendRange, DEFAULT_BEND_RANGE),
    // LED por defecto, como una mesa de verdad
    vuMode: pickOption(VU_MODES, config.vuMode, "led"),
    analysisMode: pickOption(ANALYSIS_MODES, config.analysisMode, "auto"),
    showKey: config.showKey !== false,
    showArtwork: config.showArtwork !== false,
    lockLoadWhilePlaying: config.lockLoadWhilePlaying !== false,
  };
}

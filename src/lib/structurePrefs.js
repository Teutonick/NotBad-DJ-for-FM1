// Ajustes del indicador de estructura y del aviso de fin de pista.
//
// Viven en el mismo objeto `config` que el resto (localStorage
// "mini-dj-config"). Aquí solo están los valores por defecto y el resolutor,
// para que el diálogo ⚙, la caja del deck y el indicador lean exactamente lo
// mismo y no haya dos verdades.

import { DEFAULT_PHRASE_SIZE, PHRASE_SIZES } from "../audio/structure";
import { pickOption } from "./config";

export const STRUCTURE_UNITS = ["kicks", "bars"];
export const END_WARN_MODES = ["seconds", "percent"];

// Umbrales de aviso del indicador, en kicks. Ámbar = "prepárate"; rojo = "ya".
export const DEFAULT_WARN_AMBER = 16;
export const DEFAULT_WARN_RED = 4;

// Aviso de fin de pista
export const DEFAULT_END_SECONDS = 30;
export const DEFAULT_END_PERCENT = 10;

// Velocidad de la marquesina del nombre de la pista, en píxeles por segundo.
// 0 = quieta (el nombre se corta con puntos suspensivos).
export const MARQUEE_SPEEDS = [0, 15, 30, 60];
export const DEFAULT_MARQUEE_SPEED = 30;

// Cómo se pinta la pantalla del deck. Son dos ajustes:
//
//   - Las CIFRAS: las letras de siempre o la pantalla LCD. La pantalla lleva un
//     montaje FIJO de casillas —siete segmentos donde solo van números, catorce
//     donde hace falta un signo o una letra—, decidido en LcdDisplay y no por
//     lo que toque escribir en cada momento.
//   - El TÍTULO: las letras de siempre o matriz de 5 x 7 puntos, que es lo que
//     se lee bien a ese tamaño. Ver src/components/Readout.jsx.
export const LCD_FONTS = ["rounded", "lcd"];
export const TITLE_FONTS = ["rounded", "dot"];

// Lo que hubiera guardado de antes, cuando cada modo se elegía a mano, cae en
// el modo de pantalla que le toca. Lo que no se reconozca se descarta luego.
const VIEJOS = ["segments", "seg7", "seg14", "dot"];
const migraCifras = (v) => (VIEJOS.includes(v) ? "lcd" : v);
const migraTitulo = (v) => (VIEJOS.includes(v) ? "dot" : v);

const clampInt = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

/**
 * Ajustes efectivos a partir de la config guardada. Nunca devuelve valores
 * imposibles: el rojo siempre queda por debajo o igual que el ámbar, que es
 * lo que espera quien mira el número.
 */
export function resolveStructurePrefs(config = {}) {
  const phraseSize = pickOption(
    PHRASE_SIZES,
    config.phraseSize,
    DEFAULT_PHRASE_SIZE,
  );
  const unit = pickOption(STRUCTURE_UNITS, config.structureUnit, "kicks");
  const amber = clampInt(config.structureWarnAmber, 1, 128, DEFAULT_WARN_AMBER);
  const red = Math.min(
    amber,
    clampInt(config.structureWarnRed, 1, 128, DEFAULT_WARN_RED),
  );
  const endMode = pickOption(END_WARN_MODES, config.endWarnMode, "seconds");

  return {
    show: config.showStructure !== false,
    marqueeSpeed: pickOption(
      MARQUEE_SPEEDS,
      config.marqueeSpeed,
      DEFAULT_MARQUEE_SPEED,
    ),
    titleFont: pickOption(
      TITLE_FONTS,
      migraTitulo(config.titleFont),
      "rounded",
    ),
    lcdFont: pickOption(LCD_FONTS, migraCifras(config.lcdFont), "rounded"),
    phraseSize,
    unit,
    warnAmber: amber,
    warnRed: red,
    endWarn: {
      enabled: config.endWarnOn !== false,
      mode: endMode,
      seconds: clampInt(config.endWarnSeconds, 5, 300, DEFAULT_END_SECONDS),
      percent: clampInt(config.endWarnPercent, 1, 50, DEFAULT_END_PERCENT),
    },
  };
}

/**
 * Segundos que le quedan a la pista para que empiece a avisar, según el modo.
 * Devuelve 0 si el aviso está apagado o no hay duración.
 */
export function endWarnSeconds(endWarn, duration) {
  if (!endWarn?.enabled || !(duration > 0)) return 0;
  return endWarn.mode === "percent"
    ? (duration * endWarn.percent) / 100
    : Math.min(endWarn.seconds, duration);
}

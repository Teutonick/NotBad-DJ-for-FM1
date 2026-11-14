import { describe, it, expect } from "vitest";
import {
  CONFIG_KEY,
  loadConfig,
  saveConfig,
  pickOption,
  resolveConfig,
} from "../../../src/lib/config";
import {
  BEND_RANGES,
  DEFAULT_BEND_RANGE,
  DEFAULT_PITCH_RANGE,
  PITCH_RANGES,
} from "../../../src/lib/constants";

// localStorage de mentira (el proyecto unit corre en Node, sin DOM)
const memoria = (inicial = {}) => {
  const datos = { ...inicial };
  return {
    datos,
    getItem: (k) => (k in datos ? datos[k] : null),
    setItem: (k, v) => {
      datos[k] = String(v);
    },
  };
};
const rota = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("loadConfig / saveConfig", () => {
  it("lee lo guardado y lo vuelve a guardar igual", () => {
    const st = memoria();
    saveConfig({ vuMode: "continuous", pitchRange: 16 }, st);
    expect(JSON.parse(st.datos[CONFIG_KEY])).toEqual({
      vuMode: "continuous",
      pitchRange: 16,
    });
    expect(loadConfig(st)).toEqual({ vuMode: "continuous", pitchRange: 16 });
  });

  it("sin nada guardado, o con algo que no es un objeto, empieza vacía", () => {
    expect(loadConfig(memoria())).toEqual({});
    for (const raro of ["[1,2]", "42", '"hola"', "null", "{roto"]) {
      expect(loadConfig(memoria({ [CONFIG_KEY]: raro }))).toEqual({});
    }
  });

  it("sin almacenamiento (modo privado, cuota llena) no revienta", () => {
    expect(loadConfig(rota)).toEqual({});
    expect(() => saveConfig({ a: 1 }, rota)).not.toThrow();
    expect(loadConfig(null)).toEqual({});
  });
});

describe("pickOption", () => {
  it("se queda con el valor si está en la lista, y si no con el de reserva", () => {
    expect(pickOption(["led", "continuous"], "continuous", "led")).toBe(
      "continuous",
    );
    expect(pickOption(["led", "continuous"], "xyz", "led")).toBe("led");
    expect(pickOption(["led", "continuous"], undefined, "led")).toBe("led");
  });

  it("en listas de números acepta el número escrito como texto", () => {
    expect(pickOption(PITCH_RANGES, "16", 8)).toBe(16);
    expect(pickOption(PITCH_RANGES, 17, 8)).toBe(8);
    expect(pickOption(PITCH_RANGES, null, 8)).toBe(8);
    expect(pickOption(PITCH_RANGES, undefined, 8)).toBe(8);
    // Como antes: null pasa por Number() y vale 0, que en algunas listas existe
    expect(pickOption([0, 15, 30], null, 30)).toBe(0);
  });
});

describe("resolveConfig", () => {
  it("sin nada guardado da los valores de fábrica", () => {
    expect(resolveConfig({})).toEqual({
      pitchRange: DEFAULT_PITCH_RANGE,
      bendRange: DEFAULT_BEND_RANGE,
      vuMode: "led",
      analysisMode: "auto",
      showKey: true,
      showArtwork: true,
      lockLoadWhilePlaying: true,
    });
    expect(resolveConfig()).toEqual(resolveConfig({}));
  });

  it("respeta lo que se eligió en ⚙", () => {
    const r = resolveConfig({
      pitchRange: PITCH_RANGES[2],
      bendRange: BEND_RANGES[0],
      vuMode: "continuous",
      analysisMode: "deck",
      showKey: false,
      showArtwork: false,
      lockLoadWhilePlaying: false,
    });
    expect(r).toEqual({
      pitchRange: PITCH_RANGES[2],
      bendRange: BEND_RANGES[0],
      vuMode: "continuous",
      analysisMode: "deck",
      showKey: false,
      showArtwork: false,
      lockLoadWhilePlaying: false,
    });
  });

  it("un valor imposible cae en el de fábrica, igual en la app que en el diálogo", () => {
    const r = resolveConfig({
      pitchRange: 13,
      bendRange: "x",
      vuMode: "xyz",
      analysisMode: "nunca",
    });
    expect(r.pitchRange).toBe(DEFAULT_PITCH_RANGE);
    expect(r.bendRange).toBe(DEFAULT_BEND_RANGE);
    expect(r.vuMode).toBe("led");
    expect(r.analysisMode).toBe("auto");
  });
});

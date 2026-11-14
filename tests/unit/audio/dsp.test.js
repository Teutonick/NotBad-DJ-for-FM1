import { describe, it, expect } from "vitest";
import {
  dbToGain,
  gainToDb,
  getChannels,
  mod,
  onePoleAlpha,
} from "../../../src/audio/dsp";
import { makeAudioBuffer, sine } from "../../helpers/signals";

describe("dsp", () => {
  it("onePoleAlpha: coeficiente del filtro de un polo dt/(rc+dt)", () => {
    const dt = 1 / 44100;
    const rc = 1 / (2 * Math.PI * 200);
    expect(onePoleAlpha(200, 44100)).toBe(dt / (rc + dt));
    // Más frecuencia de corte, más alfa (deja pasar más)
    expect(onePoleAlpha(2500, 44100)).toBeGreaterThan(onePoleAlpha(200, 44100));
  });

  it("getChannels: hasta dos canales del buffer", () => {
    const l = sine({ seconds: 0.01, sampleRate: 8000 });
    expect(getChannels(makeAudioBuffer([l], 8000))).toHaveLength(1);
    expect(getChannels(makeAudioBuffer([l, l, l], 8000))).toHaveLength(2);
    expect(getChannels(makeAudioBuffer([l, l, l], 8000), 3)).toHaveLength(3);
  });

  it("mod: módulo siempre positivo", () => {
    expect(mod(14, 12)).toBe(2);
    expect(mod(-1, 12)).toBe(11);
    expect(mod(-12, 12)).toBe(0);
  });

  it("gainToDb y dbToGain son inversas", () => {
    expect(gainToDb(1)).toBe(0);
    expect(gainToDb(0.5)).toBeCloseTo(-6.0206, 4);
    expect(dbToGain(-6.0206)).toBeCloseTo(0.5, 4);
    expect(dbToGain(0)).toBe(1);
  });
});

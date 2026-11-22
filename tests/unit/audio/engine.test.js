import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AudioEngine } from "../../../src/audio/engine";
import {
  installFakeAudio,
  pathExists,
  targetsOf,
} from "../../helpers/fakeAudio";

let engine;
let fake;

beforeEach(() => {
  fake = installFakeAudio();
  engine = new AudioEngine();
});

afterEach(() => {
  fake.restore();
});

describe("Equal Power crossfader", () => {
  it("isolates each deck at the endpoints and keeps squared gain constant", () => {
    for (const x of [0, 0.25, 0.5, 0.75, 1]) {
      engine.setCrossfader(x);
      const a = engine.deckA.xfGain.gain;
      const b = engine.deckB.xfGain.gain;
      expect(a.value).toBeCloseTo(Math.cos((x * Math.PI) / 2));
      expect(b.value).toBeCloseTo(Math.sin((x * Math.PI) / 2));
      expect(a.value ** 2 + b.value ** 2).toBeCloseTo(1);
      expect(a.automation.at(-1)).toEqual(["target", a.value, 0, 0.012]);
    }
  });
});

describe("DJ filter", () => {
  it("uses the dry branch at center and sweeps the active filter on each side", () => {
    const d = engine.deckA;
    engine.setDeckFilter("A", 0);
    expect(
      [d.filterDry, d.filterLow, d.filterHigh].map((n) => n.gain.value),
    ).toEqual([1, 0, 0]);
    engine.setDeckFilter("A", -1);
    expect(d.filterLow.gain.value).toBe(1);
    expect(d.lowPass.frequency.value).toBeCloseTo(80);
    engine.setDeckFilter("A", 1);
    expect(d.filterHigh.gain.value).toBe(1);
    expect(d.highPass.frequency.value).toBeCloseTo(8000);
  });
});

describe("ruteo", () => {
  it("el PFL sale post-EQ y PRE-fader", () => {
    const { filter, preGain, cueGain } = engine.deckA;
    // El envío a auriculares cuelga del filtro (final del bloque de EQ)…
    expect(targetsOf(fake.ctx, filter)).toContain(cueGain);
    // …y no del fader del canal: bajar el volumen no puede callar el PFL
    expect(pathExists(fake.ctx, preGain, cueGain)).toBe(false);
    expect(pathExists(fake.ctx, cueGain, engine.cueDest)).toBe(true);
    expect(pathExists(fake.ctx, cueGain, fake.ctx.destination)).toBe(false);
  });

  it("el VU del canal mide en el mismo punto que el PFL", () => {
    expect(targetsOf(fake.ctx, engine.deckA.filter)).toContain(
      engine.deckA.meter,
    );
    expect(engine.getMeterAnalyser("A")).toBe(engine.deckA.meter);
    expect(engine.getMeterAnalyser("B")).toBe(engine.deckB.meter);
  });

  it("el VU del master mide DESPUÉS del limitador", () => {
    expect(targetsOf(fake.ctx, engine.limiter)).toContain(engine.masterMeter);
    expect(engine.getMeterAnalyser("master")).toBe(engine.masterMeter);
  });

  it("del master a la salida no hay nada más que el limitador", () => {
    expect(targetsOf(fake.ctx, engine.masterGain)).toEqual([engine.limiter]);
    expect(targetsOf(fake.ctx, engine.limiter)).toContain(fake.ctx.destination);
  });

  it("salida dedicada por deck (mezcla externa): el deck sale por su stream y no por el master", () => {
    const { xfGain } = engine.deckA;
    engine.setDeckOutput("A", true);
    const stream = engine.getDeckStream("A");
    expect(stream).toBeTruthy();
    expect(pathExists(fake.ctx, xfGain, engine.deckA.directDest)).toBe(true);
    expect(pathExists(fake.ctx, xfGain, engine.masterGain)).toBe(false);
    // El otro deck sigue yendo al master
    expect(pathExists(fake.ctx, engine.deckB.xfGain, engine.masterGain)).toBe(
      true,
    );

    // Y de vuelta al master, sin quedarse colgado también del stream
    engine.setDeckOutput("A", false);
    expect(pathExists(fake.ctx, xfGain, engine.masterGain)).toBe(true);
    expect(pathExists(fake.ctx, xfGain, engine.deckA.directDest)).toBe(false);
  });

  it("cada deck llega a la salida pasando por EQ, fader y crossfader", () => {
    for (const deck of [engine.deckA, engine.deckB]) {
      expect(targetsOf(fake.ctx, deck.eqPreGain)).toContain(deck.low);
      expect(pathExists(fake.ctx, deck.high, deck.filter)).toBe(true);
      expect(targetsOf(fake.ctx, deck.filter)).toContain(deck.preGain);
      expect(targetsOf(fake.ctx, deck.preGain)).toContain(deck.xfGain);
      expect(pathExists(fake.ctx, deck.xfGain, fake.ctx.destination)).toBe(
        true,
      );
    }
  });
});

describe("EQ", () => {
  it("el kill de una banda la manda al mínimo y respeta el resto", () => {
    engine.setDeckEQ("A", { gain: 0, low: -26, mid: 0, high: 3 });
    expect(engine.deckA.low.gain.value).toBe(-26);
    expect(engine.deckA.mid.gain.value).toBe(0);
    expect(engine.deckA.high.gain.value).toBe(3);
  });

  it("con refuerzos grandes recorta el pre-gain para no saturar", () => {
    engine.setDeckEQ("A", { gain: 0, low: 0, mid: 0, high: 0 });
    const flat = engine.deckA.eqPreGain.gain.value;
    engine.setDeckEQ("A", { gain: 0, low: 8, mid: 8, high: 8 });
    expect(engine.deckA.eqPreGain.gain.value).toBeLessThan(flat);
  });

  it("los cortes no disparan el auto-trim", () => {
    engine.setDeckEQ("A", { gain: 0, low: -26, mid: -26, high: -26 });
    expect(engine.deckA.eqPreGain.gain.value).toBeCloseTo(1, 6);
  });
});

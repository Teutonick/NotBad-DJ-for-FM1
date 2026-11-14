import { describe, it, expect } from "vitest";
import { PALETTE_LEVELS, reduceColumn } from "../../../src/lib/waveColors";

// Índice de paleta a partir de (graves, agudos), como lo guarda el análisis
const idx = (low, high) => low * PALETTE_LEVELS + high;

describe("reduceColumn", () => {
  it("la altura es el pico del tramo", () => {
    const onda = Float32Array.from([0.1, 0.9, 0.3, 0.2]);
    const col = reduceColumn(onda, null, 0, 4, false);
    expect(col.peak).toBeCloseTo(0.9, 6); // Float32: 0.8999…
    expect(col.ci).toBe(0);
  });

  it("el color es la MEDIA de todo el tramo, no una muestra suelta", () => {
    // Bombo (muchos graves) cada 4 muestras y agudos entre medias. Muestreando
    // una de cada cuatro el color se enganchaba al bombo: «todo naranja».
    const onda = new Float32Array(8).fill(0.5);
    const bandas = Uint8Array.from([
      idx(5, 0),
      idx(1, 4),
      idx(1, 4),
      idx(1, 4),
      idx(5, 0),
      idx(1, 4),
      idx(1, 4),
      idx(1, 4),
    ]);
    const { ci } = reduceColumn(onda, bandas, 0, 8, true);
    // graves: (5+1+1+1)·2/8 = 2 · agudos: (0+4+4+4)·2/8 = 3
    expect(ci).toBe(idx(2, 3));
  });

  it("recorta el tramo a los datos: por delante del 0 y más allá del final", () => {
    const onda = Float32Array.from([0.4, 0.6]);
    expect(reduceColumn(onda, null, -3, 1, false).peak).toBeCloseTo(0.4, 6);
    expect(reduceColumn(onda, null, 1, 99, false).peak).toBeCloseTo(0.6, 6);
  });

  it("un tramo vacío no da columna", () => {
    const onda = Float32Array.from([0.4, 0.6]);
    expect(reduceColumn(onda, null, 5, 9, false)).toBeNull();
    expect(reduceColumn(onda, null, 1, 1, false)).toBeNull();
  });
});

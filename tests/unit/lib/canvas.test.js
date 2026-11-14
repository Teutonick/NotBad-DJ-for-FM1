import { describe, it, expect } from "vitest";
import { fitCanvas } from "../../../src/lib/canvas";

// Un <canvas> de mentira que cuenta cuántas veces se le cambia el tamaño
// (cada asignación de width/height lo reinicia entero en un navegador)
const lienzo = (width = 0, height = 0) => {
  const c = { asignaciones: 0, _w: width, _h: height };
  Object.defineProperty(c, "width", {
    get: () => c._w,
    set: (v) => {
      c.asignaciones += 1;
      c._w = Math.trunc(v); // el DOM guarda enteros
    },
  });
  Object.defineProperty(c, "height", {
    get: () => c._h,
    set: (v) => {
      c.asignaciones += 1;
      c._h = Math.trunc(v);
    },
  });
  return c;
};

describe("fitCanvas (regla de oro de los canvas)", () => {
  it("con un ancho fraccionario redondea y NO reasigna en cada frame", () => {
    const c = lienzo();
    const rect = { width: 600.4, height: 80.6 };
    expect(fitCanvas(c, rect)).toEqual({ w: 600, h: 81, resized: true });
    const antes = c.asignaciones;
    for (let i = 0; i < 30; i++) fitCanvas(c, rect);
    expect(c.asignaciones).toBe(antes);
    expect(fitCanvas(c, rect).resized).toBe(false);
  });

  it("si el lienzo aún no mide (0), usa el tamaño de reserva", () => {
    const c = lienzo();
    expect(
      fitCanvas(c, { width: 0, height: 0 }, { fallbackW: 600, fallbackH: 80 }),
    ).toMatchObject({ w: 600, h: 80 });
  });

  it("nunca baja de 1 px", () => {
    const c = lienzo();
    expect(fitCanvas(c, { width: 0, height: 0 })).toMatchObject({ w: 1, h: 1 });
  });

  it("con densidad de píxeles, el lienzo mide el tamaño en pantalla por dpr", () => {
    const c = lienzo();
    expect(fitCanvas(c, { width: 10.3, height: 100 }, { dpr: 2 })).toEqual({
      w: 21,
      h: 200,
      resized: true,
    });
  });
});

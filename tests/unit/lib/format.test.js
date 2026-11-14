import { describe, it, expect } from "vitest";
import {
  formatClock,
  formatSize,
  stripExtension,
} from "../../../src/lib/format";

describe("stripExtension", () => {
  it.each([
    ["tema.mp3", "tema"],
    ["mi.tema.final.flac", "mi.tema.final"],
    ["tema", "tema"],
    [".mp3", ".mp3"],
    ["", ""],
    [null, ""],
    [undefined, ""],
  ])("%s → %s", (entrada, salida) => {
    expect(stripExtension(entrada)).toBe(salida);
  });
});

describe("formatClock", () => {
  it("minutos y segundos con dos cifras", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(65.9)).toBe("01:05");
    expect(formatClock(599)).toBe("09:59");
  });

  it("con horas (por defecto) pasa a hh:mm:ss desde la hora", () => {
    expect(formatClock(3599)).toBe("59:59");
    expect(formatClock(3600)).toBe("01:00:00");
    expect(formatClock(4500)).toBe("01:15:00");
  });

  it("sin horas sigue contando minutos (lista y grabación, como antes)", () => {
    expect(formatClock(4500, { hours: false })).toBe("75:00");
  });

  it("sin un número usa el texto de reserva; lo negativo cuenta como cero", () => {
    expect(formatClock(NaN)).toBe("00:00");
    expect(formatClock(undefined, { fallback: "--:--" })).toBe("--:--");
    expect(formatClock(Infinity, { fallback: "--:--" })).toBe("--:--");
    expect(formatClock(-3)).toBe("00:00");
  });
});

describe("formatSize", () => {
  it("en MB con un decimal; sin número, vacío", () => {
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatSize(1536 * 1024)).toBe("1.5 MB");
    expect(formatSize(undefined)).toBe("");
  });
});

import { describe, it, expect, beforeAll } from "vitest";
import {
  LOCALES,
  LOCALE_CODES,
  DEFAULT_LOCALE,
  loadLocale,
} from "../../../src/i18n/locales";
import { LANGUAGES, translate } from "../../../src/i18n/context";
import { fm1English } from "../../../src/i18n/locales/en";

const codes = [...LOCALE_CODES];
const reference = LOCALES[DEFAULT_LOCALE];
const referenceKeys = Object.keys(reference).sort();
const keysFor = (code) =>
  code === "ru" ? [...referenceKeys, ...Object.keys(fm1English)] : referenceKeys;
// Parámetros de una cadena: "Deck {side}" → ["side"]
const placeholders = (str) =>
  [...String(str).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

// Este bloque va primero: mira la caché antes de que nadie cargue nada
describe("carga bajo demanda", () => {
  it("solo el inglés (la reserva de todas las claves) viene de serie", () => {
    expect(Object.keys(LOCALES)).toEqual([DEFAULT_LOCALE]);
  });

  it("un idioma se carga al pedirlo, una vez, y queda en la caché", async () => {
    const es = await loadLocale("es");
    expect(es.deck).toBe("Deck {side}");
    expect(LOCALES.es).toBe(es);
    expect(await loadLocale("es")).toBe(es);
  });

  it("un idioma que no existe da el inglés y no ensucia la caché", async () => {
    expect(await loadLocale("xx")).toBe(LOCALES.en);
    expect(LOCALES).not.toHaveProperty("xx");
  });
});

describe("traducciones", () => {
  beforeAll(() => Promise.all(codes.map(loadLocale)));

  it("el selector de idioma ofrece exactamente los idiomas que existen", () => {
    expect(LANGUAGES.map((l) => l.code).sort()).toEqual(codes.sort());
    expect(codes).toContain("ru");
  });

  it.each(codes)("%s tiene las mismas claves que el inglés", (code) => {
    const keys = Object.keys(LOCALES[code]);
    const expected = keysFor(code);
    const missing = expected.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !expected.includes(k));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it.each(codes)("%s conserva los parámetros de cada cadena", (code) => {
    const wrong = [];
    for (const key of keysFor(code)) {
      const expected = placeholders(reference[key] ?? fm1English[key]);
      const actual = placeholders(LOCALES[code][key] ?? "");
      if (expected.join() !== actual.join())
        wrong.push({ key, expected, actual });
    }
    expect(wrong).toEqual([]);
  });

  it.each(codes)("%s no deja ninguna cadena vacía", (code) => {
    const empty = keysFor(code).filter(
      (k) => !String(LOCALES[code][k] ?? "").trim(),
    );
    expect(empty).toEqual([]);
  });
});

describe("translate", () => {
  beforeAll(() => loadLocale("es"));

  it("sustituye los parámetros", () => {
    expect(translate("es", "deck", { side: "A" })).toBe("Deck A");
  });

  it("cae al inglés con un idioma desconocido y devuelve la clave si no existe", () => {
    expect(translate("xx", "bpm")).toBe(LOCALES.en.bpm);
    expect(translate("es", "clave-que-no-existe")).toBe("clave-que-no-existe");
  });

  it("mete el valor del parámetro tal cual, aunque lleve $ (búsqueda «a$&b»)", () => {
    for (const query of ["a$&b", "$$", "x$'y", "$1"]) {
      expect(translate("en", "noMatch", { query })).toBe(
        `No song matches "${query}".`,
      );
    }
  });
});

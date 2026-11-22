import { createContext, useContext } from "react";
import { LOCALES, DEFAULT_LOCALE } from "./locales";
import { fm1English } from "./locales/en";

export const STORAGE_KEY = "mini-dj-lang";

export const LANGUAGES = [
  { code: "es", label: "Español" },
  { code: "en", label: "English" },
  { code: "ru", label: "Русский" },
  { code: "ca", label: "Català" },
  { code: "gl", label: "Galego" },
  { code: "eu", label: "Euskara" },
  { code: "fr", label: "Français" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Português" },
  { code: "zh", label: "中文" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
];

export const SUPPORTED = new Set(LANGUAGES.map((l) => l.code));

// Idioma guardado > idiomas del navegador > inglés
export function detectLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED.has(saved)) return saved;
  } catch {
    // almacenamiento no disponible
  }
  const candidates =
    typeof navigator !== "undefined"
      ? [...(navigator.languages || []), navigator.language].filter(Boolean)
      : [];
  for (const tag of candidates) {
    const base = String(tag).toLowerCase().split("-")[0];
    if (SUPPORTED.has(base)) return base;
  }
  return DEFAULT_LOCALE;
}

// t(clave, {params}); cae al inglés y, si falta, devuelve la clave
export function translate(lang, key, params) {
  const dict = LOCALES[lang] || LOCALES[DEFAULT_LOCALE];
  let str = dict[key] ?? LOCALES[DEFAULT_LOCALE][key] ?? fm1English[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      // Con función: un "$&" o "$$" en el valor (lo que escribe el usuario en
      // la búsqueda, una ruta…) se mete tal cual y no como patrón.
      str = str.replaceAll(`{${k}}`, () => String(v));
    }
  }
  return str;
}

export const I18nContext = createContext(null);

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n debe usarse dentro de I18nProvider");
  return ctx;
}

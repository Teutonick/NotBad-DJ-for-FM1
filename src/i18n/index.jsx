import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_LOCALE, LOCALES, loadLocale } from "./locales";
import {
  I18nContext,
  STORAGE_KEY,
  SUPPORTED,
  detectLanguage,
  translate,
} from "./context";

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(detectLanguage);
  // Cuando llega el diccionario, este estado provoca un render en el que
  // `ready` pasa a true; hasta entonces los textos salen en inglés
  const [, setLoaded] = useState(0);
  const ready = Boolean(LOCALES[lang]);
  const textLang = ready ? lang : DEFAULT_LOCALE;

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // main.jsx ya trae el idioma detectado antes de pintar; esto cubre el caso
  // de que no (los tests, o si aquella carga falló): se ve en inglés hasta
  // que llega.
  useEffect(() => {
    if (ready) return;
    let cancelled = false;
    loadLocale(lang).then(() => {
      if (!cancelled) setLoaded((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [lang, ready]);

  // Se cambia cuando el diccionario ya está: así no hay un paso por inglés
  const setLang = useCallback(async (code) => {
    if (!SUPPORTED.has(code)) return;
    await loadLocale(code);
    setLangState(code);
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // almacenamiento no disponible
    }
  }, []);

  const value = useMemo(
    () => ({
      lang,
      setLang,
      t: (key, params) => translate(textLang, key, params),
    }),
    [lang, textLang, setLang]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

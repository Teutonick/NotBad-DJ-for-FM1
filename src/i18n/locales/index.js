import en from "./en";

export const DEFAULT_LOCALE = "en";

// Solo el inglés va en el bundle principal: es la reserva de cualquier clave
// que falte. El resto (≈ 6 kB gzip cada uno, un tercio del bundle entre todos)
// se baja al elegirlo; main.jsx espera al detectado antes del primer pintado,
// así que no se ve un parpadeo en inglés.
const loaders = import.meta.glob(["./*.js", "!./index.js", "!./en.js"], {
  import: "default",
});
const codeOf = (path) => path.slice(2, -3); // "./es.js" → "es"

export const LOCALE_CODES = [DEFAULT_LOCALE, ...Object.keys(loaders).map(codeOf)];

// Caché de diccionarios ya cargados; translate() lee de aquí
export const LOCALES = { [DEFAULT_LOCALE]: en };

// Carga un idioma (una sola vez) y lo devuelve; si no existe, el inglés
export async function loadLocale(code) {
  if (LOCALES[code]) return LOCALES[code];
  const load = loaders[`./${code}.js`];
  if (!load) return LOCALES[DEFAULT_LOCALE];
  LOCALES[code] = await load();
  return LOCALES[code];
}

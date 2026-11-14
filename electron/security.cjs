// Reglas del proceso principal que no necesitan Electron: qué fichero se
// sirve por app://, qué URL es de la propia app y cuánto registro se acepta
// de la página. Van aparte para poder probarlas con Vitest
// (tests/unit/electron/security.test.js); main.cjs solo las usa.

const path = require("node:path");

// Ruta en disco que corresponde a una petición app://…, o null si la URL no
// se entiende (un "%zz" hace lanzar a decodeURIComponent) o se sale de dist/.
function resolveDistPath(distDir, requestUrl) {
  let relative;
  try {
    relative = decodeURIComponent(new URL(requestUrl).pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }
  const target = path.resolve(distDir, relative || "index.html");
  if (target !== distDir && !target.startsWith(distDir + path.sep)) return null;
  return target;
}

// ¿Es `url` del mismo origen que `origin`? Se comparan esquema y host (con
// puerto). Con startsWith, "http://localhost:51730" pasaba por
// "http://localhost:5173". No se usa URL.origin porque para un esquema propio
// como app: Node devuelve "null".
function isSameOrigin(url, origin) {
  try {
    const a = new URL(url);
    const b = new URL(origin);
    return a.protocol === b.protocol && a.host === b.host;
  } catch {
    return false;
  }
}

// Enlaces que se abren en el navegador del sistema: solo web
function isExternalHttp(url) {
  try {
    return /^https?:$/.test(new URL(url).protocol);
  } catch {
    return false;
  }
}

// Límite de líneas de registro por ventana de tiempo. La página escribe en el
// fichero a través del proceso principal, y de forma síncrona: un bucle que
// registre sin parar no puede bloquearlo. Lo que se tira se cuenta, para
// dejar constancia en cuanto se vuelva a escribir.
function createLineLimiter({ max, windowMs, now = Date.now }) {
  let windowStart = now();
  let used = 0;
  let dropped = 0;
  return {
    take() {
      const t = now();
      if (t - windowStart >= windowMs) {
        windowStart = t;
        used = 0;
      }
      if (used < max) {
        used++;
        return true;
      }
      dropped++;
      return false;
    },
    // Devuelve cuántas se han tirado desde la última vez y pone la cuenta a 0
    takeDropped() {
      const n = dropped;
      dropped = 0;
      return n;
    },
  };
}

module.exports = { resolveDistPath, isSameOrigin, isExternalHttp, createLineLimiter };

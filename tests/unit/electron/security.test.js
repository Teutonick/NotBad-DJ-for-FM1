import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  resolveDistPath,
  isSameOrigin,
  isExternalHttp,
  createLineLimiter,
  allowPermission,
} from "../../../electron/security.cjs";

// Las reglas del proceso principal que no necesitan Electron: qué fichero se
// sirve por app://, a dónde se deja navegar y cuánto registro acepta.
const DIST = path.resolve("/opt/mini-dj/dist");

describe("resolveDistPath", () => {
  it("sirve los ficheros de dist/, y la raíz es index.html", () => {
    expect(resolveDistPath(DIST, "app://mini-dj/assets/index-abc.js")).toBe(
      path.join(DIST, "assets/index-abc.js"),
    );
    expect(resolveDistPath(DIST, "app://mini-dj/")).toBe(
      path.join(DIST, "index.html"),
    );
    expect(resolveDistPath(DIST, "app://mini-dj/caf%C3%A9.png")).toBe(
      path.join(DIST, "café.png"),
    );
  });

  it("nada fuera de dist/, tampoco con la barra escapada", () => {
    expect(
      resolveDistPath(DIST, "app://mini-dj/..%2F..%2Fetc/passwd"),
    ).toBeNull();
    // Los "%2e%2e" ya los quita URL al normalizar: se queda dentro
    expect(resolveDistPath(DIST, "app://mini-dj/%2e%2e/secret")).toBe(
      path.join(DIST, "secret"),
    );
  });

  it("una ruta mal escapada o una URL rota no revientan: null", () => {
    expect(resolveDistPath(DIST, "app://mini-dj/%zz")).toBeNull();
    expect(resolveDistPath(DIST, "no es una url")).toBeNull();
  });
});

describe("isSameOrigin", () => {
  it("compara esquema y host, no el principio de la cadena", () => {
    expect(isSameOrigin("app://mini-dj/index.html", "app://mini-dj")).toBe(
      true,
    );
    expect(
      isSameOrigin("http://localhost:5173/#x", "http://localhost:5173/"),
    ).toBe(true);
    expect(
      isSameOrigin("http://localhost:51730/", "http://localhost:5173/"),
    ).toBe(false);
    expect(isSameOrigin("app://mini-dj.evil/", "app://mini-dj")).toBe(false);
    expect(isSameOrigin("https://mini-dj/", "app://mini-dj")).toBe(false);
  });

  it("una URL rota no es del mismo origen (y no lanza)", () => {
    expect(isSameOrigin("::::", "app://mini-dj")).toBe(false);
    expect(isSameOrigin("", "app://mini-dj")).toBe(false);
  });
});

describe("isExternalHttp", () => {
  it("solo http y https se abren en el navegador del sistema", () => {
    expect(isExternalHttp("https://github.com/Wincha/mini-dj")).toBe(true);
    expect(isExternalHttp("http://example.com")).toBe(true);
    expect(isExternalHttp("file:///etc/passwd")).toBe(false);
    expect(isExternalHttp("javascript:alert(1)")).toBe(false);
    expect(isExternalHttp("no es una url")).toBe(false);
  });
});

describe("createLineLimiter", () => {
  it("deja pasar hasta el máximo por ventana y cuenta lo que tira", () => {
    let t = 0;
    const limiter = createLineLimiter({ max: 3, windowMs: 1000, now: () => t });
    expect([1, 2, 3, 4, 5].map(() => limiter.take())).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
    // Ventana nueva: vuelve a dejar pasar y dice cuántas se tiraron
    t = 1000;
    expect(limiter.take()).toBe(true);
    expect(limiter.takeDropped()).toBe(2);
    expect(limiter.takeDropped()).toBe(0);
  });
});

// T35: los permisos (salida de audio, nombres de los dispositivos…) solo para
// la propia app, no para cualquier contenido que acabe dentro de la ventana
describe("allowPermission", () => {
  const PERMITIDOS = new Set(["media", "speaker-selection"]);
  const APP = "app://mini-dj";
  const pide = (permission, origin, pageUrl = "app://mini-dj/index.html") =>
    allowPermission({
      permission,
      origin,
      pageUrl,
      allowed: PERMITIDOS,
      appOrigin: APP,
    });

  it("concede los de la lista a la propia app", () => {
    expect(pide("media", "app://mini-dj")).toBe(true);
    expect(pide("media", "app://mini-dj/")).toBe(true);
    expect(pide("speaker-selection", "app://mini-dj/index.html")).toBe(true);
  });

  it("nunca los que no están en la lista", () => {
    expect(pide("geolocation", "app://mini-dj")).toBe(false);
  });

  it("a otro origen, no (aunque se parezca)", () => {
    expect(pide("media", "https://evil.example")).toBe(false);
    expect(pide("media", "app://mini-dj.evil")).toBe(false);
  });

  it("si Electron no dice el origen, vale el de la página (siempre la app)", () => {
    expect(pide("media", "")).toBe(true);
    expect(pide("media", undefined)).toBe(true);
    expect(pide("media", "", "https://evil.example/")).toBe(false);
  });

  it("en desarrollo, el origen es el del servidor de Vite", () => {
    expect(
      allowPermission({
        permission: "media",
        origin: "http://localhost:5173",
        pageUrl: "",
        allowed: PERMITIDOS,
        appOrigin: "http://localhost:5173",
      }),
    ).toBe(true);
    expect(
      allowPermission({
        permission: "media",
        origin: "http://localhost:51730",
        pageUrl: "",
        allowed: PERMITIDOS,
        appOrigin: "http://localhost:5173",
      }),
    ).toBe(false);
  });
});

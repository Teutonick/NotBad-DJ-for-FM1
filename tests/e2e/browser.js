// Arranque compartido de las pruebas de navegador: servidor de Vite + Chrome
// del sistema con puppeteer-core (nada de descargar navegadores).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, preview } from "vite";
import puppeteer from "puppeteer-core";
import { clickTrack, encodeWav } from "../helpers/wav.js";

const CANDIDATOS = [
  process.env.MINI_DJ_CHROME,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

export function findChrome() {
  return CANDIDATOS.find((ruta) => existsSync(ruta)) || null;
}

/** Pista WAV en disco, para dársela al <input type="file">. */
export function makeTrackFile(nombre, bpm, seconds = 20) {
  const dir = join(tmpdir(), "mini-dj-e2e");
  mkdirSync(dir, { recursive: true });
  const ruta = join(dir, nombre);
  writeFileSync(ruta, encodeWav(clickTrack({ bpm, seconds })));
  return ruta;
}

export async function startApp() {
  await build({ logLevel: "error" });
  const server = await preview({
    base: "/fm1-dj/",
    preview: { host: "127.0.0.1", port: 0 },
    logLevel: "error",
  });
  const { port } = server.httpServer.address();

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      // Sin tarjeta de sonido (WSL2, CI): salida muda y sin exigir gesto
      "--mute-audio",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });

  return {
    url: `http://127.0.0.1:${port}/fm1-dj/`,
    browser,
    async close() {
      await browser.close();
      await server.close();
    },
  };
}

export async function openPage(browser, url) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // The silent sink gives Web Audio a rendering clock even without CoreAudio.
  // Playback and the actual graph still run inside Chromium.
  await page.evaluateOnNewDocument(() => {
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(options) {
        super({ sinkId: { type: "none" }, ...options });
      }
      setSinkId(id) {
        return super.setSinkId(id || { type: "none" });
      }
    };
  });

  page.on("pageerror", (err) => console.error("[página]", err.message));
  await page.goto(url, { waitUntil: "networkidle0" });
  return page;
}

// Los <input type="file"> de los decks son los que NO admiten varios archivos
// (el de la lista de canciones sí). Orden en la página: deck A, deck B.
export async function loadTrackIntoDeck(page, side, ruta) {
  const inputs = await page.$$('input[type="file"]:not([multiple])');
  await inputs[side === "A" ? 0 : 1].uploadFile(ruta);
}

// BPM de un deck, sin redondear: el deck lo deja en data-bpm (el de la
// pista) y data-running-bpm (con el pitch). El LCD lo pinta redondeado y
// en segmentos, así que leerlo de la pantalla no vale.
export function readBpm(page, side, { running = false } = {}) {
  return page.evaluate(
    (s, r) => {
      const d = document.querySelector(
        `[data-testid="deck"][data-side="${s}"]`,
      );
      const n = parseFloat(r ? d?.dataset.runningBpm : d?.dataset.bpm);
      return Number.isFinite(n) && n > 0 ? n : null;
    },
    side,
    running,
  );
}

/** Espera a que el deck tenga BPM y lo devuelve como número. */
export async function waitForBpm(page, side, timeout = 40000) {
  return page
    .waitForFunction(
      (s) => {
        const d = document.querySelector(
          `[data-testid="deck"][data-side="${s}"]`,
        );
        const n = parseFloat(d?.dataset.bpm);
        return Number.isFinite(n) && n > 0 ? n : false;
      },
      { timeout, polling: 300 },
      side,
    )
    .then((h) => h.jsonValue());
}

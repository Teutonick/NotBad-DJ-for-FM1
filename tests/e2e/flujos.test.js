import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  findChrome,
  loadTrackIntoDeck,
  makeTrackFile,
  openPage,
  readBpm,
  startApp,
  waitForBpm,
} from "./browser.js";

const chrome = findChrome();
const suite = chrome ? describe : describe.skip;
if (!chrome) {
  console.warn(
    "[e2e] No hay Chrome instalado: se saltan las pruebas de navegador.",
  );
}

// Selectores por CONTENIDO o por data-testid, no por clases: sobreviven a un
// retoque de estilos.

let app;
let page;

suite("flujos de la aplicación en el navegador", () => {
  beforeAll(async () => {
    app = await startApp();
    page = await openPage(app.browser, app.url);
  });

  afterAll(async () => {
    await app?.close();
  });

  // Botón por su texto (el índice elige entre deck A y deck B). `exacto`:
  // «SYNC» no tiene que coger también «MASTER SYNC».
  const botonesCon = async (texto, exacto) => {
    const todos = await page.$$("button");
    const encontrados = [];
    for (const b of todos) {
      const txt = await b.evaluate((el) => el.textContent.trim());
      if (exacto ? txt === texto : txt.includes(texto)) encontrados.push(b);
    }
    return encontrados;
  };
  const pulsar = async (texto, index = 0, exacto = false) =>
    (await botonesCon(texto, exacto))[index].click();

  // Abre ⚙ en una pestaña y espera a que esté pintada
  const abrirAjustes = async (pestaña) => {
    const settings = await page.waitForSelector(
      '[aria-label="Settings: audio outputs and analysis"]',
    );
    await settings.click();
    await page.waitForFunction(
      (p) =>
        [...document.querySelectorAll("button")].some(
          (b) => b.textContent.trim() === p,
        ),
      { timeout: 5000 },
      pestaña,
    );
    await pulsar(pestaña, 0, true);
  };
  const cerrarAjustes = () =>
    page.$$eval("button", (bs) =>
      bs.find((b) => b.textContent.trim() === "✕")?.click(),
    );

  it("serves the NotBad favicon and keeps tab rows free of vertical scrolling", async () => {
    await page.waitForSelector("select[aria-label]");
    await page.select("select[aria-label]", "ru");
    await page.waitForFunction(() => document.documentElement.lang === "ru");
    expect(await page.title()).toMatch(/^NotBad DJ for FM1/);
    const favicon = await page.$eval('link[rel="icon"]', (link) => link.href);
    expect(favicon).toContain("/NotBad-DJ-for-FM1/notbad-dj.svg");
    expect((await fetch(favicon)).ok).toBe(true);

    await page.setViewport({ width: 540, height: 900 });
    try {
      expect(
        await page.$$eval('[role="tablist"]', (rows) =>
          rows.every((row) => getComputedStyle(row).overflowY === "visible"),
        ),
      ).toBe(true);
    } finally {
      await page.setViewport({ width: 1440, height: 900 });
    }
  });

  it("opens the firmware tab with flashing disabled before a package is verified", async () => {
    await page.waitForSelector("select[aria-label]");
    await page.select("select[aria-label]", "en");
    await abrirAjustes("Firmware");
    const dialog = await page.waitForSelector('[role="dialog"]');
    expect(
      await dialog.$eval('input[type="file"]', (file) => file.accept),
    ).toBe(".fwsc");
    expect(
      await dialog.$$eval(
        "button",
        (buttons) =>
          buttons.find(
            (button) => button.textContent.trim() === "Install FM-1 DJ 0.1.0",
          )?.disabled,
      ),
    ).toBeUndefined();
    await cerrarAjustes();
  });

  it("carga una pista y detecta su BPM", async () => {
    const ruta = makeTrackFile("deck-a-128.wav", 128, 25);
    await loadTrackIntoDeck(page, "A", ruta);

    await page.waitForFunction(
      "document.body.textContent.includes('deck-a-128')",
      { timeout: 20000 },
    );
    const bpm = await waitForBpm(page, "A", 45000);
    expect(bpm).toBeGreaterThan(126);
    expect(bpm).toBeLessThan(130);
  });

  it("reproduce: el playhead avanza", async () => {
    await page.click('[data-testid="deck-transport"]');
    await page.waitForFunction(
      "(document.querySelector('[data-testid=deck] audio')?.currentTime || 0) > 0.3",
      { timeout: 15000, polling: 100 },
    );
    const t1 = await page.evaluate(
      "document.querySelector('[data-testid=deck] audio').currentTime",
    );
    expect(t1).toBeGreaterThan(0.3);

    await page.click('[data-testid="deck-transport"]');
    const parado = await page.evaluate(
      "document.querySelector('[data-testid=deck] audio').paused",
    );
    expect(parado).toBe(true);
  });

  it("sincroniza el segundo deck con el primero", async () => {
    await loadTrackIntoDeck(
      page,
      "B",
      makeTrackFile("deck-b-132.wav", 132, 25),
    );
    const bpmB = await waitForBpm(page, "B", 45000);
    expect(bpmB).toBeGreaterThan(130);
    expect(bpmB).toBeLessThan(134);

    // El SYNC del deck B lo lleva al BPM del A ajustando su pitch
    await pulsar("SYNC", 1, true);

    await page.waitForFunction(
      () => {
        const v = [...document.querySelectorAll('[data-testid="deck"]')].map(
          (d) => parseFloat(d.dataset.runningBpm),
        );
        return v.length === 2 && Math.abs(v[0] - v[1]) < 0.5;
      },
      { timeout: 10000, polling: 200 },
    );
    const a = await readBpm(page, "A", { running: true });
    const b = await readBpm(page, "B", { running: true });
    expect(Math.abs(a - b)).toBeLessThan(0.5);
  });

  it("los ajustes sobreviven a recargar la página", async () => {
    await page.select("select[aria-label]", "en");
    await abrirAjustes("Safety");

    // El bloqueo de carga es la PRIMERA casilla de la pestaña (la segunda es
    // el aviso de fin de pista), y viene encendido de serie
    const casilla = 'input[type="checkbox"]';
    expect(await page.$eval(casilla, (e) => e.checked)).toBe(true);
    await page.click(casilla);
    await cerrarAjustes();

    // Con pistas cargadas la página no se queda nunca «sin red» del todo
    // (networkidle0 caducaba): basta con que vuelva a estar pintada
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector('[data-testid="deck"]');
    await abrirAjustes("Safety");
    expect(await page.$eval(casilla, (e) => e.checked)).toBe(false);

    // Se deja como estaba para no arrastrar el ajuste a los demás tests
    await page.click(casilla);
    await cerrarAjustes();
  });

  it("cambiar de idioma no rompe el layout", async () => {
    const desbordes = [];
    for (const code of [
      "es",
      "ca",
      "gl",
      "eu",
      "fr",
      "it",
      "pt",
      "zh",
      "ja",
      "ko",
      "ru",
      "en",
    ]) {
      await page.select("select[aria-label]", code);
      await page.waitForFunction(
        `document.documentElement.lang === '${code}'`,
        { timeout: 5000 },
      );
      if (code === "ru") {
        await page.waitForFunction(() =>
          document.body.textContent.includes("Подключить FM-1"),
        );
      }

      const info = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        // Elementos que se salen por la derecha del viewport
        fuera: [...document.querySelectorAll("body *")].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.right > window.innerWidth + 1;
        }).length,
      }));
      if (info.scrollWidth > info.clientWidth + 1 || info.fuera > 0) {
        desbordes.push({ code, ...info });
      }
    }
    expect(desbordes).toEqual([]);
  });
  it("imports production demo assets and keeps the library across reload", async () => {
    await pulsar("Add demo tracks", 0, true);
    await page.waitForFunction(() =>
      document.body.textContent.includes("Afterglow-128.wav"),
    );
    // The tracks appear in the UI before the IndexedDB writes finish.
    await page.waitForFunction(
      () =>
        new Promise((resolve) => {
          const open = indexedDB.open("mini-dj");
          open.onerror = () => resolve(false);
          open.onsuccess = () => {
            const db = open.result;
            const read = db
              .transaction("tracks")
              .objectStore("tracks")
              .getAll();
            read.onsuccess = () => {
              const names = new Set(read.result.map((track) => track.name));
              resolve(
                names.has("Beacon-124.wav") && names.has("Afterglow-128.wav"),
              );
            };
            read.onerror = () => resolve(false);
            db.close();
          };
        }),
    );
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForFunction(() =>
      document.body.textContent.includes("Beacon-124.wav"),
    );
    expect(
      await page.$eval("[aria-label=Headphones]", (section) =>
        [...section.querySelectorAll("button")]
          .filter((button) => button.textContent.includes("PFL"))
          .every((button) => button.disabled),
      ),
    ).toBe(true);
  });

  it("loads a track with → B while MIDI is connected and shares transport between page and panel", async () => {
    await page.evaluate(() => {
      const input = Object.assign(new EventTarget(), {
        id: "fm1-in",
        name: "FM-1 DJ",
        state: "connected",
      });
      const midi = (bytes) =>
        input.dispatchEvent(
          Object.assign(new Event("midimessage"), {
            data: Uint8Array.from(bytes),
          }),
        );
      const output = {
        id: "fm1-out",
        name: "FM-1 DJ",
        state: "connected",
        send(bytes) {
          if (bytes[5] === 0)
            queueMicrotask(() =>
              midi([0xf0, 0x7d, 0x46, 0x44, 1, 2, 0, 0, 1, 1, 0x74, 0xf7]),
            );
        },
      };
      const access = Object.assign(new EventTarget(), {
        inputs: new Map([[input.id, input]]),
        outputs: new Map([[output.id, output]]),
      });
      Object.defineProperty(navigator, "requestMIDIAccess", {
        value: async () => access,
      });
      window.testPanel = (note) => midi([0x90, note, 100]);
    });
    await pulsar("Connect FM-1", 0, true);
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(
        (button) => button.textContent.trim() === "MIDI connected",
      ),
    );
    const deck = '[data-testid="deck"][data-side="B"]';
    const audio = deck + " audio";
    await page.evaluate(() => {
      window.testPanel(86);
      window.testPanel(88);
    });
    expect(await page.$eval(audio, (element) => element.paused)).toBe(true);
    await pulsar("→ B", 0, true);
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.src.startsWith("blob:"),
      {},
      audio,
    );
    await page.evaluate(() => window.testPanel(88));
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.currentTime > 0.25,
      {},
      audio,
    );
    await page.click(deck + ' [data-testid="deck-transport"]');
    expect(await page.$eval(audio, (element) => element.paused)).toBe(true);
    await page.click(deck + ' [data-testid="deck-transport"]');
    await page.waitForFunction(
      (selector) => !document.querySelector(selector)?.paused,
      {},
      audio,
    );
    await page.evaluate(() => window.testPanel(89));
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.paused,
      {},
      audio,
    );
  });
});

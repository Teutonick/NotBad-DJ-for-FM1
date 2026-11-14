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
    await pulsar("⚙");
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
    await pulsar("Play");
    await page.waitForFunction(
      "(document.querySelectorAll('audio')[0]?.currentTime || 0) > 0.3",
      { timeout: 15000, polling: 100 },
    );
    const t1 = await page.evaluate(
      "document.querySelectorAll('audio')[0].currentTime",
    );
    expect(t1).toBeGreaterThan(0.3);

    await pulsar("Pause");
    const parado = await page.evaluate(
      "document.querySelectorAll('audio')[0].paused",
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
      "en",
    ]) {
      await page.select("select[aria-label]", code);
      await page.waitForFunction(
        `document.documentElement.lang === '${code}'`,
        { timeout: 5000 },
      );

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
});

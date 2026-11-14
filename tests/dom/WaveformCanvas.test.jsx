import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import WaveformCanvas from "../../src/components/WaveformCanvas";

// La onda se pinta en una TIRA de tres anchos de pantalla que solo se rehace
// cuando cambian los datos. Aquí no hay canvas de verdad: un contexto falso
// apunta cada relleno y requestAnimationFrame se avanza a mano.
const W = 600;
const H = 80;
let rellenosTira; // veces que se ha pintado la tira entera (fondo de 3×W)
let pendientes;
let ahora;

const ctxFalso = () =>
  new Proxy(
    {},
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === "measureText") return () => ({ width: 0 });
        if (prop === "fillRect")
          return (x, y, w) => {
            if (w === 3 * W) rellenosTira += 1;
          };
        return () => {};
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    },
  );

const frames = (n = 3) => {
  for (let i = 0; i < n; i++) {
    ahora += 40; // por encima de los 33 ms del límite de 30 fps
    const cbs = pendientes;
    pendientes = [];
    act(() => cbs.forEach((p) => p.cb(ahora)));
  }
};

const onda = Float32Array.from({ length: 4000 }, (_, i) => (i % 9) / 9);
const rejilla = (bpm, n) => Array.from({ length: n }, (_, i) => (i * 60) / bpm);
const audio = { current: { duration: 200, currentTime: 0, paused: true } };
// Mismas instancias en cada render: si cambian, la tira se rehace por ellas
const PALETA = Array(36).fill("#0f0");
const VENTANA = { current: { from: 0, to: 0 } };

const pintar = (props) =>
  render(
    <WaveformCanvas
      waveData={onda}
      bandIndex={null}
      palette={PALETA}
      audioRef={audio}
      windowRef={VENTANA}
      zoom={8}
      hotCues={[]}
      {...props}
    />,
  );

beforeEach(() => {
  rellenosTira = 0;
  pendientes = [];
  ahora = 1000;
  let id = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    id += 1;
    pendientes.push({ id, cb });
    return id;
  });
  // Cancelar de verdad: si no, el bucle del render anterior sigue vivo
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((quita) => {
    pendientes = pendientes.filter((p) => p.id !== quita);
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    ctxFalso,
  );
  HTMLCanvasElement.prototype.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: W,
    height: H,
    right: W,
    bottom: H,
    x: 0,
    y: 0,
  });
  globalThis.Path2D = class {
    rect() {}
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  delete HTMLCanvasElement.prototype.getBoundingClientRect;
});

describe("WaveformCanvas: la tira cacheada", () => {
  it("se pinta una vez y no en cada frame, ni al volver a renderizar con lo mismo", () => {
    const beats = rejilla(128, 400);
    const utils = pintar({ beats });
    frames(5);
    // Un cambio que no toca la onda (el loop) tampoco la rehace
    utils.rerender(
      <WaveformCanvas
        waveData={onda}
        bandIndex={null}
        palette={PALETA}
        audioRef={audio}
        windowRef={VENTANA}
        zoom={8}
        hotCues={[]}
        beats={beats}
        loopIn={3}
      />,
    );
    frames(5);
    expect(rellenosTira).toBe(1);
  });

  it("se rehace al retocar el BPM aunque no cambien ni el número de beats ni el primero", () => {
    const utils = pintar({ beats: rejilla(128, 400) });
    frames();
    expect(rellenosTira).toBe(1);

    // ±0,01 BPM pivotando sobre el ancla: mismo primer beat, misma cantidad
    utils.rerender(
      <WaveformCanvas
        waveData={onda}
        bandIndex={null}
        palette={PALETA}
        audioRef={audio}
        windowRef={VENTANA}
        zoom={8}
        hotCues={[]}
        beats={rejilla(128.01, 400)}
      />,
    );
    frames();
    expect(rellenosTira).toBe(2);
  });
});

describe("WaveformCanvas: clic para saltar", () => {
  // T32: el navegador actualiza currentTime a bloques; entre medias la onda
  // se dibuja con el playhead interpolado. El clic tiene que convertirse con
  // la MISMA ventana que se ve, no con el currentTime crudo, o en play cae
  // unos píxeles desviado (aquí 0,1 s = 2,4 px).
  it("en play, el clic cae donde se ve, con la ventana dibujada", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const { computeWaveWindow } = await import("../../src/lib/waveWindow");
    vi.spyOn(performance, "now").mockImplementation(() => ahora);
    HTMLCanvasElement.prototype.setPointerCapture = () => {};
    const sonando = {
      current: {
        duration: 200,
        currentTime: 100,
        paused: false,
        playbackRate: 1,
      },
    };
    const onSeek = vi.fn();
    const { container } = render(
      <WaveformCanvas
        waveData={onda}
        bandIndex={null}
        palette={PALETA}
        audioRef={sonando}
        windowRef={VENTANA}
        zoom={8}
        hotCues={[]}
        beats={[]}
        onSeek={onSeek}
      />,
    );
    // Dos frames sin que el <audio> actualice: el segundo se dibuja 40 ms
    // por delante de currentTime
    frames(2);
    const canvas = container.querySelector("canvas");
    fireEvent.pointerDown(canvas, { clientX: 300, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 300, pointerId: 1 });

    const visto = computeWaveWindow({
      total: onda.length,
      zoom: 8,
      curFrac: 100.04 / 200,
      hasDuration: true,
    });
    const esperado = (visto.leftFrac + 0.5 * visto.windowFrac) * 200;
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek.mock.calls[0][0]).toBeCloseTo(esperado, 6);
    delete HTMLCanvasElement.prototype.setPointerCapture;
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { readTrackMetadata } from "../../src/audio/metadata";
import {
  computeOnsetEnvelope,
  detectTempoAsync,
} from "../../src/audio/beatGrid";
import { t } from "../helpers/render.jsx";
import {
  audio,
  deckEl,
  esperar,
  instalarAudioFalso,
  montarDeck,
  pista,
  ponerEn,
  posicion,
} from "../helpers/deck.jsx";

// Caracterización de la CARGA de una pista encima de otra, tal y como va hoy,
// para poder sacar la carga a un hook (useTrackLoader) sin cambiar nada: qué
// se borra, qué vuelve de lo guardado y qué resultados tardíos de la pista
// anterior se descartan.

vi.mock("../../src/components/WaveformCanvas", () => ({ default: () => null }));
vi.mock("../../src/audio/beatGrid", async (importOriginal) => ({
  ...(await importOriginal()),
  computeOnsetEnvelope: vi.fn(async () => null),
  detectTempoAsync: vi.fn(async () => null),
}));
vi.mock("../../src/audio/metadata", () => ({
  readTrackMetadata: vi.fn(async () => ({})),
}));

let motor;
beforeEach(() => {
  ({ motor } = instalarAudioFalso());
});
afterEach(() => vi.clearAllMocks());

const montar = async (extra = {}) => {
  const onCues = vi.fn();
  const onBpmDetected = vi.fn();
  const r = await montarDeck({ motor, onCues, onBpmDetected, ...extra });
  // Carga otra pista desde la lista (nuevo loadToken), con lo que traiga guardado
  const cargar = async (nombre, track = {}, token = 2) => {
    r.rerender(deckEl({ ...r.props, file: pista(nombre), token, track }));
    await waitFor(() =>
      expect(titulo(r.container)).toBe(
        track.title || nombre.replace(/\.[^.]+$/, ""),
      ),
    );
  };
  return {
    ...r,
    onCues,
    onBpmDetected,
    cargar,
    ultimo: () => onCues.mock.calls.at(-1)?.[1],
  };
};

const titulo = (container) =>
  container
    .querySelector('[data-testid="lcd"] [title]')
    ?.getAttribute("title") ?? null;

describe("cargar otra pista encima", () => {
  it("lo de la pista anterior (cues, loops, loop activo, rejilla) no pasa a la nueva", async () => {
    const r = await montar({
      track: { bpm: 120, gridAnchor: 0, gridManual: true },
    });
    ponerEn(12);
    act(() => r.api().hotCue(0));
    ponerEn(10);
    act(() => r.api().loopIn());
    ponerEn(14);
    act(() => r.api().loopOut());
    act(() => r.api().loopSave());
    expect(r.ultimo()).toMatchObject({
      hotCues: [{ i: 0, t: 12 }],
      savedLoops: [{ start: 10, end: 14 }],
    });

    await r.cargar("otra.mp3");
    await waitFor(() =>
      expect(r.ultimo()).toEqual({
        hotCues: [],
        savedLoops: [],
        activeLoop: undefined,
      }),
    );
    // Rejilla: la nueva empieza sin BPM (manual ya no)
    expect(r.onBpmDetected).toHaveBeenLastCalledWith("A", null, {
      anchor: 0,
      manual: false,
    });
  });

  it("lo guardado de la pista nueva vuelve, con el loop APAGADO", async () => {
    const r = await montar();
    const guardado = {
      bpm: 124,
      gridAnchor: 0.3,
      gridManual: true,
      artist: "Nina",
      title: "Aurora",
      hotCues: [{ i: 2, t: 33, name: "drop" }],
      savedLoops: [
        { id: "loop-1", start: 10, end: 10.2, beats: 0.5, name: "coro" },
      ],
      activeLoop: { start: 10, end: 10.2, beats: 0.5 },
    };
    await r.cargar("aurora.mp3", guardado);
    await waitFor(() =>
      expect(r.ultimo()).toMatchObject({
        hotCues: [{ i: 2, t: 33, name: "drop" }],
        savedLoops: [{ id: "loop-1", start: 10, end: 10.2 }],
        activeLoop: { start: 10, end: 10.2 },
      }),
    );
    expect(r.onBpmDetected).toHaveBeenLastCalledWith("A", 124, {
      anchor: 0.3,
      manual: true,
    });
    // Las etiquetas guardadas no se vuelven a leer del archivo
    expect(readTrackMetadata).toHaveBeenCalledTimes(1); // solo la primera pista

    // Apagado: tocando por encima del OUT no da vueltas
    ponerEn(10.1);
    audio.saltos = [];
    await act(async () => r.api().playPause());
    await esperar(300);
    expect(audio.saltos).toEqual([]);
  });

  it("la carga para la reproducción y deja la pista nueva al principio", async () => {
    const r = await montar({ lockLoadWhilePlaying: false });
    ponerEn(20);
    await act(async () => r.api().playPause());
    expect(audio.desde).not.toBeNull();
    await r.cargar("otra.mp3");
    expect(audio.desde).toBeNull();
    expect(posicion()).toBe(0);
    // y el deck lo sabe: el botón vuelve a ser Play
    await waitFor(() =>
      expect(r.getByRole("button", { name: t("play") })).toBeInTheDocument(),
    );
  });

  // T37: el deck se paraba, pero el padre seguía creyendo que sonaba (y la
  // lista lo usaba de referencia de tonalidad)
  it("avisa al padre de que ya no suena", async () => {
    const onPlayingChange = vi.fn();
    const r = await montar({ lockLoadWhilePlaying: false, onPlayingChange });
    await act(async () => r.api().playPause());
    expect(onPlayingChange).toHaveBeenLastCalledWith("A", true);
    await r.cargar("otra.mp3");
    await waitFor(() =>
      expect(onPlayingChange).toHaveBeenLastCalledWith("A", false),
    );
  });

  it("cargar sobre un deck parado no avisa de nada", async () => {
    const onPlayingChange = vi.fn();
    const r = await montar({ onPlayingChange });
    await r.cargar("otra.mp3");
    await esperar(50);
    expect(onPlayingChange).not.toHaveBeenCalled();
  });

  it("un roll que se estaba manteniendo no mueve la pista nueva al soltarlo", async () => {
    const r = await montar({
      lockLoadWhilePlaying: false,
      track: { bpm: 120, gridAnchor: 0, gridManual: true },
    });
    ponerEn(20);
    await act(async () => r.api().playPause());
    act(() => r.api().rollStart(0.25));
    await esperar(100);
    await r.cargar("otra.mp3");
    audio.saltos = [];
    act(() => r.api().rollEnd());
    expect(audio.saltos).toEqual([]);
    expect(r.ultimo().activeLoop).toBeUndefined();
  });

  it("las etiquetas de la pista anterior que llegan tarde no pisan las de la nueva", async () => {
    let soltarPrimera;
    readTrackMetadata
      .mockImplementationOnce(() => new Promise((res) => (soltarPrimera = res)))
      .mockImplementationOnce(async () => ({ artist: "B", title: "Tema B" }));
    const r = await montar();
    await r.cargar("b.mp3");
    await waitFor(() => expect(titulo(r.container)).toBe("Tema B"));

    await act(async () => soltarPrimera({ artist: "A", title: "Tema A" }));
    await esperar(20);
    expect(titulo(r.container)).toBe("Tema B");
  });

  it("el mismo loadToken no vuelve a cargar; uno nuevo con el mismo archivo, sí", async () => {
    const r = await montar();
    // Cada carga hace un load() en el <audio>
    const cargas = () => HTMLMediaElement.prototype.load.mock.calls.length;
    const antes = cargas();
    r.rerender(deckEl({ ...r.props }));
    await esperar(50);
    expect(cargas()).toBe(antes);
    r.rerender(deckEl({ ...r.props, token: 2 }));
    await waitFor(() => expect(cargas()).toBe(antes + 1));
  });
});

describe("cargar desde el botón del propio deck", () => {
  it("avisa al padre para que suelte la pista de la lista, y carga", async () => {
    const onLocalLoad = vi.fn();
    const r = await montar({ onLocalLoad });
    const input = r.container.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [pista("local.mp3")] } });
    expect(onLocalLoad).toHaveBeenCalledWith("A");
    await waitFor(() => expect(titulo(r.container)).toBe("local"));
  });
});

// El ⟳ de la pestaña BPM: reanaliza ALREDEDOR del ajuste manual sobre la
// envolvente que dejó la carga, sin volver a decodificar
describe("reanálisis guiado de la rejilla", () => {
  const preparar = async () => {
    computeOnsetEnvelope.mockResolvedValueOnce(new Float32Array(8));
    const r = await montar({
      track: { bpm: 120, gridAnchor: 0.5, gridManual: true },
    });
    fireEvent.click(r.getByRole("tab", { name: t("toolsBpm") }));
    const boton = () =>
      r.container.querySelector(`button[title="${t("gridRegridTitle")}"]`);
    // Habilitado cuando acaba el análisis de la carga (y ya hay envolvente)
    await waitFor(() => expect(boton()).not.toBeDisabled());
    return { ...r, boton };
  };

  it("aplica lo que encuentra, redondeado a centésimas y como ajuste manual", async () => {
    const r = await preparar();
    detectTempoAsync.mockResolvedValueOnce({ bpm: 121.234, anchor: 0.52 });
    fireEvent.click(r.boton());
    await waitFor(() =>
      expect(r.onBpmDetected).toHaveBeenLastCalledWith("A", 121.23, {
        anchor: 0.52,
        manual: true,
      }),
    );
    expect(detectTempoAsync).toHaveBeenLastCalledWith(expect.anything(), {
      seedBpm: 120,
      seedAnchor: 0.5,
      bpmTolerance: 6,
    });
  });

  it("si mientras tanto se carga otra pista, su resultado se tira", async () => {
    const r = await preparar();
    let soltar;
    detectTempoAsync.mockImplementationOnce(
      () => new Promise((res) => (soltar = res)),
    );
    fireEvent.click(r.boton());
    await waitFor(() => expect(soltar).toBeDefined());
    await r.cargar("otra.mp3");
    await act(async () => soltar({ bpm: 125, anchor: 0.1 }));
    await esperar(20);
    expect(r.onBpmDetected).not.toHaveBeenCalledWith(
      "A",
      125,
      expect.anything(),
    );
  });
});

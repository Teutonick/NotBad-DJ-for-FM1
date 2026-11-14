import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { useDeckShortcuts } from "../../src/hooks/useDeckShortcuts";

// API imperativa de un deck, toda de mentira
const deckApi = () => ({
  playPause: vi.fn(),
  cueStop: vi.fn(),
  hotCue: vi.fn(),
  hotCueClear: vi.fn(),
  loopMove: vi.fn(),
  loopResize: vi.fn(),
  loopSave: vi.fn(),
  loopSavedToggle: vi.fn(),
  loopSavedSelect: vi.fn(),
  loopIn: vi.fn(),
  loopOut: vi.fn(),
  loopToggle: vi.fn(),
  nudgeStart: vi.fn(),
  nudgeEnd: vi.fn(),
  rollStart: vi.fn(),
  rollEnd: vi.fn(),
});

const montar = ({ suspended = false } = {}) => {
  const decks = { current: { A: deckApi(), B: deckApi() } };
  let activo;
  const Banco = ({ suspended }) => {
    const [activeDeck, setActiveDeck] = useState("A");
    activo = activeDeck;
    useDeckShortcuts({ deckRefs: decks, activeDeck, setActiveDeck, suspended });
    return <input aria-label="campo" />;
  };
  const utils = render(<Banco suspended={suspended} />);
  return {
    ...utils,
    A: decks.current.A,
    B: decks.current.B,
    activo: () => activo,
    suspender: (v) => utils.rerender(<Banco suspended={v} />),
  };
};

const pulsar = (code, opts = {}) =>
  act(() => {
    fireEvent.keyDown(window, { code, ...opts });
  });
const soltar = (code, opts = {}) =>
  act(() => {
    fireEvent.keyUp(window, { code, ...opts });
  });

describe("atajos de teclado", () => {
  it("actúan sobre el deck activo, y Q / P lo cambian", () => {
    const { A, B, activo } = montar();
    pulsar("Space");
    expect(A.playPause).toHaveBeenCalledTimes(1);
    pulsar("KeyP");
    expect(activo()).toBe("B");
    pulsar("Space");
    expect(B.playPause).toHaveBeenCalledTimes(1);
    pulsar("KeyQ");
    expect(activo()).toBe("A");
  });

  it("1-8 disparan hot cues y Shift los borra; la repetición de tecla no cuenta", () => {
    const { A } = montar();
    pulsar("Digit3");
    expect(A.hotCue).toHaveBeenCalledWith(2);
    pulsar("Digit3", { shiftKey: true });
    expect(A.hotCueClear).toHaveBeenCalledWith(2);
    pulsar("Digit3", { repeat: true });
    expect(A.hotCue).toHaveBeenCalledTimes(1);
  });

  it("el roll y el nudge duran lo que dura la tecla pulsada", () => {
    const { A } = montar();
    pulsar("KeyF");
    expect(A.rollStart).toHaveBeenCalledWith(1);
    soltar("KeyF");
    expect(A.rollEnd).toHaveBeenCalledTimes(1);
    pulsar("ArrowLeft");
    expect(A.nudgeStart).toHaveBeenCalledWith(-1);
    soltar("ArrowLeft");
    expect(A.nudgeEnd).toHaveBeenCalledTimes(1);
  });

  it("escribiendo en un campo no hay atajos", () => {
    const { A, getByLabelText } = montar();
    fireEvent.keyDown(getByLabelText("campo"), { code: "Space" });
    expect(A.playPause).not.toHaveBeenCalled();
  });

  it("soltar la tecla suelta el deck que la empezó, aunque entretanto se cambie de deck", () => {
    const { A, B } = montar();
    pulsar("ArrowLeft");
    pulsar("KeyF");
    pulsar("KeyP"); // cambio a B con las dos teclas aún pulsadas
    soltar("ArrowLeft");
    soltar("KeyF");
    expect(A.nudgeEnd).toHaveBeenCalledTimes(1);
    expect(A.rollEnd).toHaveBeenCalledTimes(1);
    expect(B.nudgeEnd).not.toHaveBeenCalled();
    expect(B.rollEnd).not.toHaveBeenCalled();
  });

  it("al perder la ventana el foco (Alt+Tab) se suelta lo que estuviera pulsado", () => {
    const { A } = montar();
    pulsar("ArrowRight");
    pulsar("KeyD");
    act(() => {
      fireEvent.blur(window);
    });
    expect(A.nudgeEnd).toHaveBeenCalledTimes(1);
    expect(A.rollEnd).toHaveBeenCalledTimes(1);
    // Y el keyup que llegue después ya no suelta nada otra vez
    soltar("ArrowRight");
    soltar("KeyD");
    expect(A.nudgeEnd).toHaveBeenCalledTimes(1);
    expect(A.rollEnd).toHaveBeenCalledTimes(1);
  });

  it("suspendidos (⚙ abierto) no hacen nada, pero lo que ya sonaba se suelta", () => {
    const { A, suspender, activo } = montar();
    pulsar("KeyF");
    suspender(true);
    pulsar("Space");
    pulsar("Digit1");
    pulsar("KeyP");
    expect(A.playPause).not.toHaveBeenCalled();
    expect(A.hotCue).not.toHaveBeenCalled();
    expect(activo()).toBe("A");
    soltar("KeyF");
    expect(A.rollEnd).toHaveBeenCalledTimes(1);
  });
});

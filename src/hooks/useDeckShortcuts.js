import { useEffect, useRef } from "react";
import { ROLL_SIZES } from "../audio/loops";

// === Atajos de teclado (actúan sobre el deck activo) ===
//
// `deckRefs.current[A|B]` es la API imperativa de cada Deck (play, cues,
// loops, roll, nudge…). Q y P eligen el deck activo.

// Teclas del loop roll, en el mismo orden que ROLL_SIZES (1/8 … 4 beats):
// de izquierda a derecha, loops cada vez más largos.
export const ROLL_KEYS = ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH"];

// Teclas que se mantienen pulsadas: al soltarlas hay que soltar el gesto
const HOLD_END = {
  ArrowLeft: "nudgeEnd",
  ArrowRight: "nudgeEnd",
  ...Object.fromEntries(ROLL_KEYS.map((code) => [code, "rollEnd"])),
};

// `suspended`: con un diálogo abierto (⚙) no se dispara nada, pero lo que ya
// estaba pulsado se sigue soltando.
export function useDeckShortcuts({
  deckRefs,
  activeDeck,
  setActiveDeck,
  suspended = false,
}) {
  // Qué deck empezó cada tecla que sigue pulsada. Al soltarla se suelta ESE
  // deck, no el activo: si entretanto se pulsa Q/P, el nudge o el roll del
  // deck de antes se quedaba enganchado. Vive en un ref para sobrevivir a
  // los cambios de deck activo, que vuelven a registrar los listeners.
  const heldRef = useRef(new Map());

  useEffect(() => {
    const held = heldRef.current;
    const release = (code) => {
      const api = held.get(code);
      if (!api) return;
      held.delete(code);
      api[HOLD_END[code]]?.();
    };

    const isTyping = (e) => {
      const tag = e.target?.tagName;
      return (
        tag === "INPUT" ||
        tag === "SELECT" ||
        tag === "TEXTAREA" ||
        e.target?.isContentEditable
      );
    };

    const onKeyDown = (e) => {
      if (suspended || isTyping(e)) return;
      const api = deckRefs.current[activeDeck];

      switch (e.code) {
        case "KeyQ":
          setActiveDeck("A");
          return;
        case "KeyP":
          setActiveDeck("B");
          return;
        default:
          break;
      }

      if (!api) return;

      // Loop roll: suena mientras se mantiene la tecla (keyup lo suelta)
      const roll = ROLL_KEYS.indexOf(e.code);
      if (roll > -1) {
        if (!e.repeat) {
          held.set(e.code, api);
          api.rollStart(ROLL_SIZES[roll]);
        }
        return;
      }

      switch (e.code) {
        case "Space":
          e.preventDefault();
          if (!e.repeat) api.playPause();
          break;
        case "KeyC":
          if (!e.repeat) api.cueStop();
          break;
        case "Digit1":
        case "Digit2":
        case "Digit3":
        case "Digit4":
        case "Digit5":
        case "Digit6":
        case "Digit7":
        case "Digit8": {
          if (e.repeat) break;
          // Shift borra, como el Shift+click en el pad
          const n = Number(e.code.slice(-1)) - 1;
          if (e.shiftKey) api.hotCueClear(n);
          else api.hotCue(n);
          break;
        }
        case "BracketLeft":
          if (!e.repeat) api.loopMove(-1);
          break;
        case "BracketRight":
          if (!e.repeat) api.loopMove(+1);
          break;
        case "Minus":
          if (!e.repeat) api.loopResize(0.5);
          break;
        case "Equal":
          if (!e.repeat) api.loopResize(2);
          break;
        case "KeyR":
          if (e.repeat) break;
          if (e.shiftKey) api.loopSavedToggle();
          else api.loopSave();
          break;
        case "Comma":
          if (!e.repeat) api.loopSavedSelect(-1);
          break;
        case "Period":
          if (!e.repeat) api.loopSavedSelect(+1);
          break;
        case "KeyI":
          if (!e.repeat) api.loopIn();
          break;
        case "KeyO":
          if (!e.repeat) api.loopOut();
          break;
        case "KeyL":
          if (!e.repeat) api.loopToggle();
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (!e.repeat) {
            held.set(e.code, api);
            api.nudgeStart(-1);
          }
          break;
        case "ArrowRight":
          e.preventDefault();
          if (!e.repeat) {
            held.set(e.code, api);
            api.nudgeStart(+1);
          }
          break;
        default:
          break;
      }
    };

    const onKeyUp = (e) => release(e.code);
    // Con Alt+Tab (o al pinchar fuera) el keyup no llega nunca: se suelta todo
    const onBlur = () => {
      for (const code of [...held.keys()]) release(code);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [activeDeck, deckRefs, setActiveDeck, suspended]);
}

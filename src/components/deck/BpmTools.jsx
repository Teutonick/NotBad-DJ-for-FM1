import PadButton from "../PadButton";
import {
  GRID_NUDGE_FINE,
  GRID_NUDGE_COARSE,
  GRID_BPM_FINE,
  GRID_BPM_COARSE,
} from "../../audio/beatGrid";
import { PHRASE_SIZES } from "../../audio/structure";
import { useI18n } from "../../i18n/context";
import { Cluster, Group } from "./parts";
import StepRow from "./StepRow";

// Pestaña «BPM»: rejilla de beats y estructura (frase). Sin estado propio:
// todo lo que pinta y todo lo que hace llega del deck.
export default function BpmTools({
  objectUrl,
  bpm,
  analyzing,
  quantize,
  setQuantize,
  onTapBeat,
  scaleGrid,
  regridFromManual,
  nudgeGrid,
  stretchGrid,
  structure,
  phraseSize,
  onPhraseSize,
  shiftPhrase,
  redetectStructure,
  resetPhrase,
  bandLow,
  beats,
}) {
  const { t } = useI18n();
  return (
    <>
      <Group label={t("gridLabel")}>
        <div className="flex flex-col gap-1">
          {/* Fila 1: TAP · quantize · octava · reanálisis guiado.
            A la derecha, el BPM BASE de la pista: es el que define
            la rejilla y NO es el pitch (el pitch va en el fader). */}
          <div className="flex items-center gap-0.5">
            <PadButton
              size="text"
              onClick={onTapBeat}
              disabled={!objectUrl}
              className="active:bg-orange-400 active:text-black"
              title={t("tapTitle")}
            >
              {t("tap")}
            </PadButton>
            <PadButton
              size="sm"
              led
              active={quantize}
              color="#a78bfa"
              onClick={() => setQuantize((q) => !q)}
              disabled={!objectUrl}
              title={t("quantizeTitle")}
            >
              Q
            </PadButton>
            <span className="w-px h-5 bg-neutral-800 mx-0.5" />
            <PadButton
              onClick={() => scaleGrid(0.5)}
              disabled={!bpm}
              title={t("gridHalveTitle")}
            >
              ÷2
            </PadButton>
            <PadButton
              onClick={() => scaleGrid(2)}
              disabled={!bpm}
              title={t("gridDoubleTitle")}
            >
              ×2
            </PadButton>
            <PadButton
              onClick={regridFromManual}
              disabled={!bpm || !!analyzing}
              title={t("gridRegridTitle")}
              className={
                analyzing === "regrid"
                  ? "bg-orange-400 border-orange-300 text-black animate-pulse"
                  : ""
              }
            >
              ⟳
            </PadButton>
            <span
              className="ml-auto pl-1 w-10 shrink-0 text-right text-[10px] text-neutral-400 tabular-nums"
              title={t("gridBaseBpmTitle")}
            >
              {bpm ? `${bpm.toFixed(2)}` : "—"}
            </span>
          </div>
          {/* Fila 2: los dos ejes del ajuste manual.
            Izquierda: mover la rejilla (fase). Derecha: separar o
            juntar los beats (BPM base de la pista). */}
          <div className="flex items-end gap-1.5">
            <Cluster label={t("gridPhaseLabel")} title={t("gridPhaseTitle")}>
              <StepRow
                onStep={nudgeGrid}
                fine={GRID_NUDGE_FINE}
                coarse={GRID_NUDGE_COARSE}
                disabled={!bpm}
                titles={[
                  t("gridPhaseBackCoarseTitle"),
                  t("gridPhaseBackFineTitle"),
                  t("gridPhaseFwdFineTitle"),
                  t("gridPhaseFwdCoarseTitle"),
                ]}
              />
            </Cluster>
            <Cluster label={t("gridTempoLabel")} title={t("gridTempoTitle")}>
              <StepRow
                onStep={stretchGrid}
                fine={GRID_BPM_FINE}
                coarse={GRID_BPM_COARSE}
                disabled={!bpm}
                titles={[
                  t("gridTempoDownCoarseTitle"),
                  t("gridTempoDownFineTitle"),
                  t("gridTempoUpFineTitle"),
                  t("gridTempoUpCoarseTitle"),
                ]}
                labels={["−−", "−", "+", "++"]}
                coarseClassName="tracking-tighter"
              />
            </Cluster>
          </div>
        </div>
      </Group>
      <Group label={t("structureLabel")}>
        <div className="flex flex-col gap-1">
          {/* Fila 1: desplazar la frase + tamaño de frase */}
          <div className="flex items-center gap-0.5">
            <StepRow
              onStep={shiftPhrase}
              fine={1}
              coarse={Math.max(1, phraseSize / 2)}
              disabled={!structure}
              titles={[
                t("phraseBackCoarseTitle", { n: Math.max(1, phraseSize / 2) }),
                t("phraseBackFineTitle"),
                t("phraseFwdFineTitle"),
                t("phraseFwdCoarseTitle", { n: Math.max(1, phraseSize / 2) }),
              ]}
            />
            <span className="w-px h-5 bg-neutral-800 mx-0.5" />
            <select
              value={phraseSize}
              onChange={(e) => onPhraseSize?.(Number(e.target.value))}
              className="h-7 w-11 shrink-0 bg-neutral-800 border border-neutral-700 rounded-lg px-0.5"
              title={t("phraseSizeTitle")}
            >
              {PHRASE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          {/* Fila 2: relanzar la detección, volver a lo detectado y
            el desplazamiento actual (ancho fijo) */}
          <div className="flex items-center gap-0.5">
            <PadButton
              onClick={redetectStructure}
              disabled={!bandLow || !beats.length}
              title={t("structureRedetectTitle")}
            >
              ⟳
            </PadButton>
            <PadButton
              onClick={resetPhrase}
              disabled={!structure?.manual}
              title={t("phraseResetTitle")}
            >
              ↺
            </PadButton>
            <span
              className={`ml-auto pl-1 w-10 shrink-0 text-right text-[10px] tabular-nums ${
                structure?.manual ? "text-amber-300" : "text-neutral-400"
              }`}
              title={t("phraseOffsetTitle")}
            >
              {structure ? `+${structure.phraseOffset}` : "—"}
            </span>
          </div>
        </div>
      </Group>
    </>
  );
}

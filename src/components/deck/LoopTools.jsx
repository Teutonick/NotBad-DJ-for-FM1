import PadButton from "../PadButton";
import { MAX_SAVED_LOOPS } from "../../lib/constants";
import { AUTO_LOOP_SIZES, ROLL_SIZES, beatsLabel } from "../../audio/loops";
import { useI18n } from "../../i18n/context";
import { Group, NameEditor } from "./parts";

// Pestaña «Loops y rolls»: loop manual y automático, loops guardados y roll.
// Sin estado propio: todo lo que pinta y todo lo que hace llega del deck.
export default function LoopTools({
  objectUrl,
  bpm,
  loopIn,
  loopOut,
  loopOn,
  loopLabel,
  setLoopInNow,
  setLoopOutNow,
  toggleLoop,
  autoLoop,
  moveLoopBy,
  resizeLoopBy,
  savedLoops,
  savedLoopIdx,
  setSavedLoopIdx,
  saveCurrentLoop,
  recallSavedLoop,
  deleteSavedLoop,
  renameSavedLoop,
  naming,
  setNaming,
  rolling,
  startRoll,
  endRoll,
}) {
  const { t } = useI18n();
  return (
    <>
      <Group label={t("loop")}>
      <div className="flex flex-col gap-1">
        {/* Fila 1: marcar el loop a mano y loops automáticos */}
        <div className="flex items-center gap-0.5">
          <PadButton
            size="md"
            led
            active={loopIn != null}
            color="#38bdf8"
            onClick={setLoopInNow}
            disabled={!objectUrl}
            title={t("loopInTitle")}
          >
            {t("loopIn")}
          </PadButton>
          <PadButton
            size="md"
            led
            active={loopOut != null}
            color="#38bdf8"
            onClick={setLoopOutNow}
            disabled={!objectUrl || loopIn == null}
            title={t("loopOutTitle")}
          >
            {t("loopOut")}
          </PadButton>
          <PadButton
            size="sm"
            led
            active={loopOn}
            onClick={toggleLoop}
            disabled={loopIn == null || loopOut == null}
            title={t("loopToggleTitle")}
          >
            ⟳
          </PadButton>
          <span className="w-px h-5 bg-neutral-800 mx-0.5" />
          {AUTO_LOOP_SIZES.map((n) => (
            <PadButton
              key={n}
              onClick={() => autoLoop(n)}
              disabled={!objectUrl || !bpm}
              title={t("loopAutoTitle", { n })}
            >
              {n}
            </PadButton>
          ))}
        </div>
        {/* Fila 2: mover el loop y doblar/partir su longitud.
            A la derecha, la longitud actual en beats. */}
        <div className="flex items-center gap-0.5">
          <PadButton
            onClick={() => moveLoopBy(-1)}
            disabled={!loopOut}
            title={t("loopMoveBackTitle")}
          >
            «
          </PadButton>
          <PadButton
            onClick={() => moveLoopBy(1)}
            disabled={!loopOut}
            title={t("loopMoveFwdTitle")}
          >
            »
          </PadButton>
          <span className="w-px h-5 bg-neutral-800 mx-0.5" />
          <PadButton
            onClick={() => resizeLoopBy(0.5)}
            disabled={!loopOut}
            title={t("loopHalveTitle")}
          >
            ÷2
          </PadButton>
          <PadButton
            onClick={() => resizeLoopBy(2)}
            disabled={!loopOut}
            title={t("loopDoubleTitle")}
          >
            ×2
          </PadButton>
          <span
            className="ml-auto pl-1 w-10 shrink-0 text-right text-[10px] text-neutral-400 tabular-nums"
            title={t("loopLengthTitle")}
          >
            {loopLabel}
          </span>
        </div>
      </div>
      </Group>
      <Group label={t("savedLoopsLabel")} className="relative">
      <PadButton
        onClick={saveCurrentLoop}
        disabled={
          loopIn == null ||
          loopOut == null ||
          savedLoops.length >= MAX_SAVED_LOOPS
        }
        title={t("savedLoopSaveTitle")}
      >
        +
      </PadButton>
      <select
        value={savedLoops.length ? savedLoopIdx : ""}
        onChange={(e) => setSavedLoopIdx(Number(e.target.value))}
        disabled={!savedLoops.length}
        className="h-7 w-20 shrink-0 bg-neutral-800 border border-neutral-700 rounded-lg px-1 disabled:opacity-40"
        title={t("savedLoopSelectTitle")}
      >
        {savedLoops.length === 0 ? (
          <option value="">{t("savedLoopsNone")}</option>
        ) : (
          savedLoops.map((l, i) => (
            <option key={l.id} value={i}>
              {l.name || `L${i + 1}`}
            </option>
          ))
        )}
      </select>
      <PadButton
        onClick={() => recallSavedLoop()}
        disabled={!savedLoops.length}
        title={t("savedLoopRecallTitle")}
      >
        ⟳
      </PadButton>
      <PadButton
        onClick={() =>
          setNaming({
            kind: "loop",
            index: savedLoopIdx,
            value: savedLoops[savedLoopIdx]?.name || "",
          })
        }
        disabled={!savedLoops.length}
        title={t("savedLoopRenameTitle")}
      >
        ✎
      </PadButton>
      <PadButton
        onClick={() => deleteSavedLoop(savedLoopIdx)}
        disabled={!savedLoops.length}
        title={t("savedLoopDeleteTitle")}
      >
        ✕
      </PadButton>
      {naming?.kind === "loop" && (
        <NameEditor
          label={t("savedLoopNameLabel")}
          value={naming.value}
          okTitle={t("nameSaveTitle")}
          cancelTitle={t("nameCancelTitle")}
          placeholder={t("namePlaceholder")}
          onChange={(value) => setNaming((n) => ({ ...n, value }))}
          onCommit={() => {
            renameSavedLoop(naming.index, naming.value);
            setNaming(null);
          }}
          onCancel={() => setNaming(null)}
        />
      )}
      </Group>
      <Group label={t("rollLabel")}>
      {ROLL_SIZES.map((n) => (
        <PadButton
          key={n}
          size="md"
          led
          active={rolling?.beats === n}
          color="#fbbf24"
          className="text-[10px]"
          onPointerDown={(e) => {
            e.preventDefault();
            // La captura garantiza recibir el "soltar" aunque el
            // puntero se salga del pad. Si el navegador no la da,
            // el roll funciona igual.
            try {
              e.currentTarget.setPointerCapture?.(e.pointerId);
            } catch {
              // puntero no capturable
            }
            startRoll(n);
          }}
          onPointerUp={endRoll}
          onPointerCancel={endRoll}
          onLostPointerCapture={endRoll}
          disabled={!objectUrl || !bpm}
          title={t("rollSizeTitle", { n: beatsLabel(n) })}
        >
          {beatsLabel(n)}
        </PadButton>
      ))}
      </Group>
    </>
  );
}

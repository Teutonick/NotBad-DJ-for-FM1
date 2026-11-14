import PadButton from "../PadButton";
import { HOT_CUE_COLORS } from "../../lib/constants";
import { useI18n } from "../../i18n/context";
import { formatClock } from "../../lib/format";
import { Group, NameEditor } from "./parts";

// Pestaña «Posición»: hot cues y beat jump. Sin estado propio: todo lo que
// pinta y todo lo que hace llega del deck.
export default function PositionTools({
  objectUrl,
  bpm,
  hotCues,
  triggerHotCue,
  clearHotCue,
  renameHotCue,
  naming,
  setNaming,
  jumpBeats,
  setJumpBeats,
  beatJump,
}) {
  const { t } = useI18n();
  return (
    <>
      <Group label={t("hotCuesLabel")} className="relative">
      <div className="grid grid-cols-4 gap-0.5">
        {hotCues.map((cue, i) => (
          <PadButton
            key={i}
            size="cue"
            led
            active={Boolean(cue)}
            color={HOT_CUE_COLORS[i]}
            sub={cue?.name || ""}
            disabled={!objectUrl}
            onClick={(e) =>
              e.shiftKey ? clearHotCue(i) : triggerHotCue(i)
            }
            onDoubleClick={(e) => {
              e.preventDefault();
              if (cue) {
                setNaming({ kind: "cue", index: i, value: cue.name || "" });
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              clearHotCue(i);
            }}
            title={
              cue
                ? t("hotCueGoTitle", {
                    n: i + 1,
                    time: formatClock(cue.t),
                  })
                : t("hotCueSetTitle", { n: i + 1 })
            }
          >
            {i + 1}
          </PadButton>
        ))}
      </div>
      {naming?.kind === "cue" && (
        <NameEditor
          label={t("hotCueNameLabel", { n: naming.index + 1 })}
          value={naming.value}
          okTitle={t("nameSaveTitle")}
          cancelTitle={t("nameCancelTitle")}
          placeholder={t("namePlaceholder")}
          onChange={(value) => setNaming((n) => ({ ...n, value }))}
          onCommit={() => {
            renameHotCue(naming.index, naming.value);
            setNaming(null);
          }}
          onCancel={() => setNaming(null)}
        />
      )}
      </Group>
      <Group label={t("jump")}>
      <PadButton
        size="sm"
        onClick={() => beatJump(-1)}
        disabled={!objectUrl || !bpm}
        title={t("jumpBackTitle", { n: jumpBeats })}
      >
        «
      </PadButton>
      <select
        value={jumpBeats}
        onChange={(e) => setJumpBeats(Number(e.target.value))}
        disabled={!objectUrl || !bpm}
        className="h-7 bg-neutral-800 border border-neutral-700 rounded-lg px-1 disabled:opacity-40"
        title={t("jumpSizeTitle")}
      >
        {[1, 2, 4, 8, 16, 32].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <PadButton
        size="sm"
        onClick={() => beatJump(+1)}
        disabled={!objectUrl || !bpm}
        title={t("jumpFwdTitle", { n: jumpBeats })}
      >
        »
      </PadButton>
      </Group>
    </>
  );
}

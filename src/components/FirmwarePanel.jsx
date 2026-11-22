import { useState } from "react";
import { useI18n } from "../i18n/context";
import { probeIdentity } from "../fm1/updater/fm1ota.js";
import { livePorts, pairs, usualName } from "../fm1/updater/fm1ports.js";
import {
  release,
  verifyBackup,
  verifyPackage,
} from "../fm1/updater/preflight.js";

const links = {
  firmwareDownload:
    "https://github.com/Teutonick/NotBad-DJ-for-FM1/releases/tag/v0.1.0",
  firmwareMFlasher: "https://github.com/jvitkauskas/m-flasher",
  firmwareStock: "https://www.m-vave.com/download",
  firmwareRecovery: "https://quixotic7.github.io/MvaveFM1Unbricker/",
};

export default function FirmwarePanel({ busy, setBusy, playing }) {
  const { t } = useI18n();
  const [verified, setVerified] = useState(false);
  const [backup, setBackup] = useState("");
  const [jedec, setJedec] = useState("");
  const chip =
    release.knownFlash[jedec.trim().replace(/^0x/i, "").toUpperCase()];
  const [identity, setIdentity] = useState(null);
  const [checking, setChecking] = useState(false);
  const [errors, setErrors] = useState({});
  const supported =
    window.isSecureContext && typeof navigator.requestMIDIAccess === "function";

  async function check(kind, work) {
    setChecking(true);
    setErrors((previous) => ({ ...previous, [kind]: "" }));
    try {
      await work();
    } catch (failure) {
      const message =
        kind === "device"
          ? failure.message
          : t(kind === "package" ? "firmwareInvalid" : "firmwareBackupInvalid");
      setErrors((previous) => ({ ...previous, [kind]: message }));
    } finally {
      setChecking(false);
    }
  }

  function selectPackage(event) {
    const file = event.target.files[0];
    setVerified(false);
    void check("package", async () => {
      if (!file) return;
      if (!(await verifyPackage(file))) throw new Error();
      setVerified(true);
    });
  }

  function selectBackup(event) {
    const files = Array.from(event.target.files);
    setBackup("");
    void check("backup", async () => {
      if (!files.length) return;
      const hash = await verifyBackup(files);
      if (!hash) throw new Error();
      setBackup(hash);
    });
  }

  async function probe() {
    setIdentity(null);
    setBusy(true);
    try {
      await check("device", async () => {
        const midi = await navigator.requestMIDIAccess({ sysex: true });
        const ports = pairs(midi);
        if (
          livePorts(midi.inputs, true).length !== 1 ||
          livePorts(midi.outputs, true).length !== 1 ||
          ports.length !== 1 ||
          !usualName(ports[0].name)
        ) {
          throw new Error(t("firmwareOneDevice"));
        }
        const { input, output } = ports[0];
        const id = await probeIdentity(input, output);
        if (
          input.state === "disconnected" ||
          output.state === "disconnected" ||
          (id?.model !== "FM-1" && !/^ota-FM(?:-1|1C)$/i.test(id?.model ?? ""))
        ) {
          throw new Error(t("firmwareNoIdentity"));
        }
        setIdentity({
          text: id.text,
          jedec: id.jedec,
          loader: /^ota-/i.test(id.model),
        });
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-sm text-neutral-300">
      <p className="rounded border border-amber-500/60 bg-amber-950/40 p-3 text-amber-100">
        {t("firmwareBlocked")}
      </p>
      <p>{t("firmwareIntro")}</p>
      {release.verifiedConfigurations.map(({ jedec, bootloader }) => (
        <p key={jedec + bootloader}>
          {t("firmwareTestedConfiguration", {
            chip: release.knownFlash[jedec],
            jedec,
            bootloader,
          })}
        </p>
      ))}
      <div className="flex flex-wrap gap-3 text-sky-300 underline">
        {Object.entries(links).map(([key, url]) => (
          <a key={key} href={url} target="_blank" rel="noreferrer">
            {t(key)}
          </a>
        ))}
      </div>
      <fieldset
        disabled={busy || checking}
        className="space-y-2 disabled:opacity-70"
      >
        <label className="block">
          {t("firmwareFile")}
          <input
            type="file"
            accept=".fwsc"
            onChange={selectPackage}
            className="mt-1 block max-w-full"
          />
        </label>
        {verified && <p role="status">{t("firmwareVerified")}</p>}
        <label className="block">
          {t("firmwareChipInput")}
          <input
            type="text"
            value={jedec}
            onChange={(event) => setJedec(event.target.value)}
            className="mt-1 block max-w-full rounded border border-neutral-500 bg-neutral-900 px-2 py-1"
          />
        </label>
        {jedec.trim() && (
          <p role="status">
            {chip ? t("firmwareChipKnown", { chip }) : t("firmwareChipUnknown")}
          </p>
        )}
        <p>{t("firmwareBackupInstructions")}</p>
        <label className="block">
          {t("firmwareBackupFiles")}
          <input
            type="file"
            accept=".bin"
            multiple
            onChange={selectBackup}
            className="mt-1 block max-w-full"
          />
        </label>
        {backup && (
          <p role="status" className="break-all">
            {t("firmwareBackupVerified", { hash: backup })}
          </p>
        )}
        <button
          type="button"
          disabled={!supported || playing}
          onClick={probe}
          className="rounded border border-neutral-500 px-3 py-1.5 disabled:opacity-40"
        >
          {t("firmwareProbe")}
        </button>
      </fieldset>
      {!supported && <p>{t("firmwareBrowser")}</p>}
      {playing && <p>{t("firmwareStopPlaying")}</p>}
      {checking && <p role="status">{t("firmwareChecking")}</p>}
      {Object.entries(errors)
        .filter(([, error]) => error)
        .map(([kind, error]) => (
          <p key={kind} role="alert" className="text-red-300">
            {error}
          </p>
        ))}
      {identity && (
        <p role="status">
          {t("firmwareReportedIdentity", { identity: identity.text })}
          {" · "}
          {identity.jedec
            ? t("firmwareReportedChip", {
                id: identity.jedec,
                chip:
                  release.knownFlash[identity.jedec] ??
                  t("firmwareChipUnknown"),
              })
            : t("firmwareChipUnavailable")}
        </p>
      )}
      <p>
        {t("firmwareKnownChips", {
          chips: Object.entries(release.knownFlash)
            .map(([id, name]) => `0x${id} ${name}`)
            .join(", "),
        })}
      </p>
      <details open={identity?.loader || undefined}>
        <summary className="cursor-pointer">
          {t("firmwareRecoveryTitle")}
        </summary>
        <ul className="list-disc space-y-1 pl-5">
          <li>{t("firmwareRecoverNormal")}</li>
          <li>{t("firmwareRecoverLoader")}</li>
          <li>{t("firmwareRecoverRom")}</li>
          <li>{t("firmwareRecoverMissing")}</li>
        </ul>
      </details>
    </div>
  );
}

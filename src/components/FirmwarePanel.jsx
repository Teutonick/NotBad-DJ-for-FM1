import { useRef, useState } from "react";
import { useI18n } from "../i18n/context";
import {
  checkUfw,
  logicalImage,
  productOf,
  sha256hex,
} from "../fm1/updater/fm1pkg.js";

const release = "https://github.com/Teutonick/NotBad-DJ-for-FM1/releases/tag/v0.1.0";
const recovery = "https://charlesvestal.github.io/fm1-base/install/";
const digest =
  "7e567d7950c2a4c601933697d3f33bcaaa38d7d1e2735e2c2734aca773b07330";
const product = "FM-1_82000100";
const checks = [
  "firmwareDevice",
  "firmwareBackup",
  "firmwarePower",
  "firmwareRisk",
];

export default function FirmwarePanel({ busy, setBusy, playing }) {
  const { t } = useI18n();
  const [image, setImage] = useState(null);
  const [checking, setChecking] = useState(false);
  const [acknowledged, setAcknowledged] = useState({});
  const [step, setStep] = useState("");
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const writing = useRef(false);
  const fileInput = useRef(null);
  const supported =
    window.isSecureContext && typeof navigator.requestMIDIAccess === "function";
  const ready =
    supported && !playing && image && checks.every((key) => acknowledged[key]);

  async function selectFile(event) {
    const file = event.target.files[0];
    setImage(null);
    setAcknowledged({});
    setError("");
    setStep("");
    setProgress(null);
    if (!file) return;
    setChecking(true);
    try {
      if (
        !file.name.toLowerCase().endsWith(".fwsc") ||
        file.size > 4 * 1024 * 1024
      ) {
        throw new Error(t("firmwareInvalid"));
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if ((await sha256hex(bytes)) !== digest || productOf(bytes) !== product) {
        throw new Error(t("firmwareInvalid"));
      }
      const validated = logicalImage(bytes);
      checkUfw(validated);
      setImage(validated);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setChecking(false);
    }
  }

  async function install() {
    if (!ready || writing.current || !window.confirm(t("firmwareConfirm")))
      return;
    writing.current = true;
    setBusy(true);
    fileInput.current.value = "";
    setImage(null);
    setAcknowledged({});
    setError("");
    setStep("firmwareConnect");
    setProgress(null);
    const protectPage = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectPage);
    try {
      const midi = await navigator.requestMIDIAccess({ sysex: true });
      const [{ Updater }, { livePorts, pairs }] = await Promise.all([
        import("../fm1/updater/fm1ota.js"),
        import("../fm1/updater/fm1ports.js"),
      ]);
      if (
        livePorts(midi.inputs).length !== 1 ||
        livePorts(midi.outputs).length !== 1 ||
        pairs(midi).length !== 1
      ) {
        throw new Error(t("firmwareOneDevice"));
      }
      const updater = new Updater(midi);
      await updater.install(
        image,
        product,
        (phase, count, size, percent) => {
          const stage = {
            start: "firmwareVerify",
            verify: "firmwareVerify",
            loader: "firmwareLoader",
            write: "firmwareWrite",
            reboot: "firmwareReboot",
          }[phase];
          if (stage) setStep(stage);
          if (phase === "write" && Number.isFinite(percent))
            setProgress(percent);
        },
        digest,
      );
      setStep("firmwareDone");
      setProgress(100);
    } catch (failure) {
      setStep("");
      setProgress(null);
      setError(failure.message || t("firmwareFailed"));
    } finally {
      window.removeEventListener("beforeunload", protectPage);
      writing.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-sm text-neutral-300">
      <p className="rounded border border-amber-500/60 bg-amber-950/40 p-3 text-amber-100">
        {t("firmwareWarning")}
      </p>
      <p>{t("firmwareIntro")}</p>
      <div className="flex flex-wrap gap-3 text-sky-300 underline">
        <a href={release} target="_blank" rel="noreferrer">
          {t("firmwareDownload")}
        </a>
        <a href={recovery} target="_blank" rel="noreferrer">
          {t("firmwareRecovery")}
        </a>
        <a
          href="https://github.com/Teutonick/NotBad-DJ-for-FM1/blob/main/DISCLAIMER.md"
          target="_blank"
          rel="noreferrer"
        >
          {t("firmwareDisclaimer")}
        </a>
        <a
          href="https://github.com/Teutonick/NotBad-DJ-for-FM1/blob/main/docs/UPSTREAM.md"
          target="_blank"
          rel="noreferrer"
        >
          {t("firmwareLicenses")}
        </a>
      </div>
      {!supported && <p role="status">{t("firmwareBrowser")}</p>}
      {playing && <p role="status">{t("firmwareStopPlaying")}</p>}
      <fieldset
        disabled={busy || checking || !supported}
        className="space-y-2 disabled:opacity-70"
      >
        <label className="block">
          {t("firmwareFile")}
          <input
            ref={fileInput}
            type="file"
            accept=".fwsc"
            onChange={selectFile}
            className="mt-1 block max-w-full"
          />
        </label>
        {image && (
          <>
            <p className="text-emerald-300">{t("firmwareVerified")}</p>
            {checks.map((key) => (
              <label key={key} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(acknowledged[key])}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setAcknowledged((previous) => ({
                      ...previous,
                      [key]: checked,
                    }));
                  }}
                />
                <span>{t(key)}</span>
              </label>
            ))}
          </>
        )}
        <button
          type="button"
          disabled={!ready}
          onClick={install}
          className="rounded border border-amber-500 bg-amber-300 px-3 py-1.5 font-semibold text-neutral-950 disabled:opacity-40"
        >
          {t("firmwareInstall")}
        </button>
      </fieldset>
      {(checking || step) && (
        <p role="status">{t(checking ? "firmwareChecking" : step)}</p>
      )}
      {(busy || progress === 100) && (
        <progress
          className="w-full"
          max="100"
          value={progress ?? undefined}
          aria-label={t("firmwareProgress")}
        />
      )}
      {error && (
        <p role="alert" className="text-red-300">
          {t("firmwareFailed")} {error}
        </p>
      )}
    </div>
  );
}

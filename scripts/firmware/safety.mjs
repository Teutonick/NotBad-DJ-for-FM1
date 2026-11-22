import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
  checkUfw,
  logicalImage,
  productOf,
  ufwEntries,
} from "../../src/fm1/updater/fm1pkg.js";

const readJson = (relative) =>
  JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));
export const tools = readJson("./toolchain.json");
const releases = readJson("../../src/fm1/updater/releases.json");
const { version } = readJson("../../package.json");
const { memory } = tools;
const build = "firmware/dj/build";
const reports = process.env.FM1_SAFETY_REPORT_DIR || join(build, "safety");
const candidate =
  process.env.FM1_CANDIDATE_FILE || join(build, `fm1-dj-${version}.fwsc`);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function inspectPackage(bytes, release, layout = memory) {
  const product = productOf(bytes);
  const digest = sha256(bytes);
  assert.match(product, /^FM-1_82\d{6}$/, "Unexpected product family");
  if (release)
    assert.equal(product, release.product, "Manifest product mismatch");
  const image = logicalImage(bytes);
  checkUfw(image);
  const parts = ufwEntries(image);
  assert.deepEqual(Object.keys(parts), ["0", "100"], "Unexpected UFW sections");
  const flash = parts[0];
  const loader = parts[100];
  assert.equal(
    flash.len,
    layout.slotEnd,
    "App image does not match the reviewed Flash map",
  );
  assert.ok(
    layout.bootEnd > 0 &&
      layout.bootEnd < layout.slotEnd &&
      layout.slotEnd <= layout.flashSize &&
      flash.off === layout.imageOffset &&
      loader.off === flash.off + flash.len &&
      loader.len > 0 &&
      loader.off + loader.len === image.length,
    "UFW sections do not match the reviewed layout",
  );
  const bootSha256 = sha256(
    image.subarray(flash.off, flash.off + layout.bootEnd),
  );
  assert.equal(
    bootSha256,
    layout.bootSha256,
    "Boot area differs from the reviewed image",
  );
  const loaderSha256 = sha256(
    image.subarray(loader.off, loader.off + loader.len),
  );
  assert.equal(
    loaderSha256,
    layout.loaderSha256,
    "OTA loader differs from the reviewed image",
  );
  if (release)
    assert.equal(digest, release.sha256, "Manifest SHA-256 mismatch");
  return { product, digest, flash, loader, bootSha256, loaderSha256 };
}

function save(name, value) {
  mkdirSync(reports, { recursive: true });
  writeFileSync(join(reports, name), JSON.stringify(value, null, 2) + "\n");
}

function gitRevision(path) {
  const result = spawnSync("git", ["-C", path, "rev-parse", "HEAD"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `Cannot read revision of ${path}`);
  return result.stdout.trim();
}

function checkCandidate() {
  const release = releases[version];
  const bytes = readFileSync(candidate);
  const info = inspectPackage(bytes, release);
  const parts = version.split(".").map(Number);
  assert.ok(
    parts.length === 3 &&
      parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 99),
  );
  assert.equal(
    info.product,
    "FM-1_82" + parts.map((part) => String(part).padStart(2, "0")).join(""),
  );
  const pins = {
    baseCommit: gitRevision("firmware/base"),
    bspCommit: gitRevision("firmware/base/bsp"),
  };
  if (release) {
    for (const [key, pin] of Object.entries(pins))
      assert.equal(pin, release[key], `Manifest ${key} mismatch`);
  }
  save("memory-report.json", {
    ...info,
    ...pins,
    releaseManifest: release ? "PASS" : "NOT VERIFIED",
  });
  writeFileSync(
    join(reports, "firmware.sha256"),
    `${info.digest}  ${basename(candidate)}\n`,
  );
}

const mandatoryJobs = ["build", "host", "fm1kit", "emulator", "installer"];
const gaps = {
  "target-stack-mmio":
    "The target build and BSP tests run, but complete target stack and MMIO analysis has not been validated.",
  "flash-power-loss":
    "No write workload exercises every erase/program cut and proves recovery and protected Flash contents.",
  "ota-recovery":
    "Full OTA interruption, resume and Download Mode recovery have not been verified.",
};

export function releaseDecision(jobs, integrity) {
  const checks = Object.fromEntries(
    mandatoryJobs.map((job) => {
      const results =
        job === "emulator"
          ? [jobs.emulator_puya, jobs.emulator_uc25hq80]
          : [jobs[job]];
      return [
        job,
        results.every((item) => item?.result === "success")
          ? "PASS"
          : results.some((item) => item?.result === "failure")
            ? "FAIL"
            : "NOT VERIFIED",
      ];
    }),
  );
  const mandatory = {
    ...checks,
    "release-manifest": integrity,
    ...Object.fromEntries(
      Object.keys(gaps).map((key) => [key, "NOT VERIFIED"]),
    ),
  };
  return {
    checks: mandatory,
    gaps,
    passed: Object.values(mandatory).every((result) => result === "PASS"),
  };
}

function report(jobs) {
  if (
    jobs.scope?.result === "success" &&
    jobs.scope.outputs?.required === "false"
  ) {
    const message =
      "Firmware Safety Gate: not applicable (no firmware-related changes).";
    console.log(message);
    if (process.env.GITHUB_STEP_SUMMARY)
      writeFileSync(process.env.GITHUB_STEP_SUMMARY, message + "\n", {
        flag: "a",
      });
    return;
  }
  const result = releaseDecision(
    jobs,
    jobs.build?.outputs?.manifest ?? "NOT VERIFIED",
  );
  const hash = jobs.build?.outputs?.digest ?? "";
  const status = result.passed ? "PREFLASH CANDIDATE" : "SAFETY FAILED";
  save("report.json", { version, sha256: hash, status, ...result, jobs });
  const md = [
    "# Firmware Safety Gate",
    "",
    `Firmware ${version}`,
    `SHA-256: ${hash || "unavailable"}`,
    "",
    "| Check | Result |",
    "| --- | --- |",
    ...Object.entries(result.checks).map(
      ([name, value]) => `| ${name} | ${value} |`,
    ),
    "",
    ...Object.entries(gaps).map(
      ([name, reason]) => `- **${name}** — ${reason}`,
    ),
    "",
    `**${status}**`,
    "",
  ].join("\n");
  writeFileSync(join(reports, "report.md"), md);
  if (process.env.GITHUB_STEP_SUMMARY)
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, md, { flag: "a" });
  if (!result.passed)
    throw new Error("Firmware release blocked. See the safety report.");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [command, argument] = process.argv.slice(2);
  if (command === "package") checkCandidate();
  else if (command === "baseline")
    inspectPackage(readFileSync(argument), releases[tools.baseline]);
  else if (command === "publish-check") {
    const release = releases[version];
    assert.ok(release, "Missing release manifest");
    const info = inspectPackage(readFileSync(candidate), release);
    const evidence = release.verifiedConfigurations;
    assert.ok(
      Array.isArray(evidence) && evidence.length > 0,
      "Missing hardware acceptance",
    );
    for (const configuration of evidence) {
      assert.ok(
        release.knownFlash[configuration.jedec] &&
          configuration.bootloader &&
          configuration.sourceFirmware &&
          configuration.evidence === "hardware-test-report" &&
          configuration.firmwareSha256 === info.digest &&
          configuration.recoveryVerified === true &&
          /^docs\/(?:[\w-]+\/)*[\w-]+\.md$/.test(configuration.reportPath) &&
          readFileSync(configuration.reportPath, "utf8").includes(info.digest),
        "Hardware acceptance must identify the tested image, bootloader, Flash, source firmware and recovery",
      );
    }
  } else if (command === "report")
    report(JSON.parse(process.env.FM1_SAFETY_JOBS || "{}"));
  else if (
    command === "pin" &&
    argument in tools &&
    typeof tools[argument] === "string"
  )
    console.log(tools[argument]);
  else if (command === "version") console.log(version);
  else
    throw new Error(
      "Usage: safety.mjs package | baseline FILE | publish-check | report | pin KEY | version",
    );
}

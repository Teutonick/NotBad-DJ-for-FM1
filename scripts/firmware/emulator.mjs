import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { firmwareVersion, packet } from "../../src/fm1/protocol.js";

const [binary, packageFile, chip, version, reportDir] = process.argv.slice(2);
assert.ok(
  binary &&
    packageFile &&
    version &&
    reportDir &&
    ["p25q80", "uc25hq80"].includes(chip),
  "Usage: emulator.mjs FM1_LIVE PACKAGE CHIP VERSION REPORT_DIR",
);
const directory = resolve(reportDir);
mkdirSync(join(directory, "work"), { recursive: true });
const flash = join(directory, "initial.bin");
rmSync(flash, { force: true });
const hello = Buffer.from(packet(0, 0, [])).toString("hex");
const state = (sequence) =>
  Buffer.from(packet(1, sequence, Array(113).fill(0))).toString("hex");
const legacy = version === "0.1.0";
const env = {
  ...process.env,
  FM1_USB_SEND: `1500:${hello};1550:${state(1)};2250:${state(2)};3000:${hello};3050:${state(3)}`,
  FM1_BENCH_KEYS: legacy
    ? "1700:C4@100,1800:C4^,1900:e1:-1"
    : "1700:PLAY,1800:PLAY^,1900:e1:-1",
};
delete env.FM1_STRICT;
delete env.FM1_FLASH_CUT;

function boot(mode, flashPath, strict = false) {
  const log = join(directory, `${mode}.log`);
  const lcd = join(directory, "work/lcd.ppm");
  rmSync(lcd, { force: true });
  const child = spawnSync(
    resolve(binary),
    [
      "--fwsc",
      resolve(packageFile),
      "--flash-chip",
      chip,
      "--flash",
      flashPath,
      "--usb",
      "--midi",
      "none",
      "--shot",
      "5000",
      "--lcd-only",
    ],
    {
      cwd: directory,
      env: { ...env, ...(strict ? { FM1_STRICT: "1" } : {}) },
      timeout: 240_000,
      maxBuffer: 8 * 1024 * 1024,
      encoding: "utf8",
    },
  );
  const output = (child.stdout ?? "") + (child.stderr ?? "");
  writeFileSync(log, output);
  assert.ifError(child.error);
  assert.equal(child.status, 0, `${chip} ${mode} did not boot; see ${log}`);
  assert.doesNotMatch(output, /(?:halt:|panic|power cut)/i);
  const incoming = [...output.matchAll(/usb in:\s+((?:[\da-f]{2} ?)+)/gi)].map(
    (match) => [...Buffer.from(match[1].replaceAll(" ", ""), "hex")],
  );
  const versions = incoming.map(firmwareVersion);
  assert.ok(
    versions.includes(version),
    `${chip} ${mode} did not reply with FM-1 DJ ${version}`,
  );
  assert.ok(
    incoming.some(
      (bytes) => bytes[0] === 0x90 && bytes[1] === (legacy ? 60 : 88),
    ),
    `${chip} ${mode} did not emit a key press over USB MIDI`,
  );
  assert.ok(
    incoming.some(
      (bytes) => bytes[0] === 0xb0 && bytes[1] === 17 && bytes[2] === 127,
    ),
    `${chip} ${mode} did not emit the encoder movement over USB MIDI`,
  );
  const image = readFileSync(lcd);
  const header = /^P6\s+240\s+240\s+255\s/.exec(
    image.subarray(0, 32).toString("ascii"),
  );
  assert.ok(header, "Missing 240×240 LCD image");
  const pixels = image.subarray(header[0].length);
  assert.equal(pixels.length, 240 * 240 * 3);
  assert.ok(
    pixels.some((pixel, index) => pixel !== pixels[index % 3]),
    "LCD has no drawn content",
  );
  writeFileSync(join(directory, `${mode}.ppm`), image);
  const contents = readFileSync(flashPath);
  assert.equal(
    contents.length,
    1024 * 1024,
    "Expected a complete saved Flash image",
  );
  assert.match(
    output,
    /flash: 0 erases \/ programs/,
    "Boot/session unexpectedly wrote Flash",
  );
  return contents;
}

const initial = boot("normal", flash);
const restarted = boot("strict-restart", flash, true);
assert.ok(
  initial.equals(restarted),
  "Flash changed across subsequent simulated startup",
);

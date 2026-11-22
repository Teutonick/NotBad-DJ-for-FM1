import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  checkFM1KitDiff,
  inspectPackage,
  inspectReleaseManifest,
  releaseDecision,
  tools,
} from "./safety.mjs";
import { ufwCrc16 } from "../../src/fm1/updater/fm1ota.js";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function encrypt(bytes) {
  let key = 0xffff;
  return Buffer.from(
    bytes.map((byte) => {
      const next = byte ^ (key & 0xff);
      key = ((key << 1) ^ (key & 0x8000 ? 0x1021 : 0)) & 0xffff;
      return next;
    }),
  );
}

const flash = Buffer.alloc(tools.memory.slotEnd, 0x5a);
const loader = Buffer.from("test loader");
const product = "FM-1_82000100";
const layout = {
  ...tools.memory,
  bootSha256: sha(flash.subarray(0, tools.memory.bootEnd)),
  loaderSha256: sha(loader),
};

function fixture({ identity = product, program = flash, ota = loader } = {}) {
  const offset = 1024;
  const image = Buffer.alloc(offset + program.length + ota.length);
  const table = Buffer.concat([program, ota].map(() => Buffer.alloc(0x50)));
  for (const [index, type, data, start] of [
    [0, 0, program, offset],
    [1, 100, ota, offset + program.length],
  ]) {
    const entry = table.subarray(index * 0x50, (index + 1) * 0x50);
    entry.writeUInt16LE(type);
    entry.writeUInt16LE(ufwCrc16(data), 4);
    entry.writeUInt32LE(start, 8);
    entry.writeUInt32LE(data.length, 12);
    encrypt(entry).copy(entry);
    data.copy(image, start);
  }
  const header = Buffer.alloc(0x40);
  header.writeUInt16LE(2, 8);
  header.writeUInt16LE(ufwCrc16(table), 2);
  header.writeUInt16LE(ufwCrc16(header.subarray(2)), 0);
  encrypt(header).copy(image);
  table.copy(image, 0x40);
  const marked = Buffer.alloc(image.length + 20);
  for (let index = 0; index < 20; index++) {
    image.copy(marked, index * 48, index * 47, (index + 1) * 47);
    marked[index * 48 + 47] =
      index < identity.length ? identity.charCodeAt(index) + index + 1 : 0x7d;
  }
  image.copy(marked, 960, 940);
  return marked;
}

test("package gate rejects CRC, identity, layout, boot/loader and digest changes", () => {
  const bytes = fixture();
  const release = { product, sha256: sha(bytes) };
  assert.equal(inspectPackage(bytes, release, layout).digest, release.sha256);
  const corrupted = Buffer.from(bytes);
  corrupted[corrupted.length - 1] ^= 0x80;
  assert.throws(() => inspectPackage(corrupted, release, layout), /checksum/);
  assert.throws(
    () =>
      inspectPackage(fixture({ identity: "FM-2_82000100" }), release, layout),
    /product family/,
  );
  assert.throws(
    () =>
      inspectPackage(
        fixture({ program: Buffer.concat([flash, Buffer.alloc(1)]) }),
        release,
        layout,
      ),
    /Flash map/,
  );
  assert.throws(
    () => inspectPackage(bytes, release, { ...layout, slotEnd: 1 }),
    /Flash map/,
  );
  const modified = Buffer.from(flash);
  modified[0] ^= 1;
  assert.throws(
    () => inspectPackage(fixture({ program: modified }), release, layout),
    /Boot area/,
  );
  assert.throws(
    () =>
      inspectPackage(
        fixture({ ota: Buffer.from("new loader") }),
        release,
        layout,
      ),
    /OTA loader/,
  );
  assert.throws(
    () => inspectPackage(bytes, { ...release, sha256: "wrong" }, layout),
    /SHA-256/,
  );
});

test("gate fails closed when any required evidence is missing or fails", () => {
  const success = { result: "success" };
  const jobs = {
    build: success,
    host: success,
    fm1kit: success,
    installer: success,
    recovery_lab: { ...success, outputs: { fast_cut_matrix: "PASS" } },
    emulator_puya: success,
    emulator_uc25hq80: success,
  };
  const current = releaseDecision(jobs, "PASS");
  assert.equal(current.passed, true);
  assert.equal(current.checks["target-stack"], "PASS");
  assert.match(current.limitations["target-mmio"], /unverified/);
  assert.equal(current.checks["fast-loader-cut-matrix"], "PASS");
  assert.equal(
    releaseDecision({ ...jobs, recovery_lab: success }, "PASS").checks[
      "fast-loader-cut-matrix"
    ],
    "NOT VERIFIED",
  );
  assert.match(current.limitations["flash-power-loss"], /unverified/);
  assert.match(current.limitations["ota-recovery"], /unverified/);
  assert.equal(
    releaseDecision({ ...jobs, build: { result: "failure" } }, "PASS").checks[
      "target-stack"
    ],
    "NOT VERIFIED",
  );
  const failed = releaseDecision(
    {
      ...jobs,
      fm1kit: { result: "failure" },
      emulator_puya: { result: "skipped" },
    },
    "NOT VERIFIED",
  );
  assert.equal(releaseDecision(jobs, "FAIL").passed, false);
  assert.equal(
    releaseDecision({ ...jobs, recovery_lab: success }, "PASS").passed,
    false,
  );
  assert.equal(failed.passed, false);
  assert.equal(failed.checks.fm1kit, "FAIL");
  assert.equal(failed.checks.emulator, "NOT VERIFIED");
  assert.equal(failed.checks["release-manifest"], "NOT VERIFIED");
});

test("valid packages with a different release digest remain diagnostic only", () => {
  const actual = {
    product,
    sha256: sha(fixture()),
    baseCommit: "base",
    bspCommit: "bsp",
  };
  assert.equal(inspectReleaseManifest(actual, actual).releaseManifest, "PASS");
  assert.equal(inspectReleaseManifest(actual).releaseManifest, "NOT VERIFIED");
  assert.deepEqual(
    inspectReleaseManifest(actual, { ...actual, sha256: "wrong" }),
    {
      releaseManifest: "FAIL",
      manifestMismatches: ["sha256"],
    },
  );
});

test("FM1Kit comparison accepts changed packages but rejects errors and inconsistent results", () => {
  const diff = {
    format: "fm1probe-diff-1",
    kind: "package",
    same: false,
    fields: [],
    parts: [],
  };
  assert.doesNotThrow(() => checkFM1KitDiff(1, diff));
  assert.doesNotThrow(() => checkFM1KitDiff(0, { ...diff, same: true }));
  assert.throws(() => checkFM1KitDiff(2, diff), /failed/);
  assert.throws(() => checkFM1KitDiff(0, diff), /Inconsistent/);
  assert.throws(
    () => checkFM1KitDiff(1, { ...diff, kind: "flashBackup" }),
    /package diff/,
  );
});

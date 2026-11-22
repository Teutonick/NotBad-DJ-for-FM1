import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fourteen, packet, shortTitle } from "../src/fm1/protocol.js";

const dir = mkdtempSync(join(tmpdir(), "fm1-dj-host-"));
const script = join(dir, "controller.txt");
const deck = (title, bpm, flags) => [
  flags,
  ...fourteen(bpm * 10),
  56,
  32,
  90,
  64,
  64,
  64,
  64,
  45,
  ...shortTitle(title),
  ...Array.from({ length: 24 }, (_, i) => 12 + ((i * 17) % 103)),
];
const payload = [
  30,
  0,
  0,
  ...deck("BEACON", 124, 1),
  ...deck("AFTERGLOW", 128, 6),
];
const state = packet(1, 1, payload);
const hex = (bytes) =>
  bytes.map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
const renewed = packet(1, 2, payload);
const broken = packet(1, 3, payload);
broken[broken.length - 2] ^= 1;
const wrongVersion = packet(1, 3, payload);
wrongVersion[4] += 1;
wrongVersion[wrongVersion.length - 2] =
  (wrongVersion[wrongVersion.length - 2] - 1) & 127;
let seed = 0x464d31;
const fuzz = Array.from({ length: 64 }, (_, length) =>
  hex([
    0xf0,
    0x7d,
    0x46,
    0x44,
    1,
    0x7e,
    ...Array.from({ length }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed >>> 25;
    }),
    0xf7,
  ]),
);
writeFileSync(
  script,
  [
    "usb plug",
    "wait 130",
    "expect usb_play_gain 0",
    ...fuzz.map((message) => `sysex ${message}`),
    `sysex ${hex(wrongVersion)}`,
    "sysex F0 7D 46 44 F7",
    "sysex F0 7D 46 44 01 01 00 77 F7",
    "wait 130",
    "expect usb_play_gain 0",
    `sysex ${hex(packet(0, 0, []))}`,
    "expect_sysex F0 7D 46 44 01 02 00 00 01 01 74 F7",
    `sysex ${hex(state)}`,
    "wait 130",
    "expect usb_play_gain 3072",
    ...[
      ["OCT-", 85],
      ["OCT+", 86],
      ["SEL", 87],
      ["PLAY", 88],
      ["HOME", 89],
      ["FX", 90],
      ["GLO", 92],
      ["ENV", 93],
      ["ARP", 94],
      ["LFO", 95],
      ["SEQ", 96],
      ["SAVE", 97],
      ["REC", 98],
    ].flatMap(([name, note]) => [
      `tap ${name}`,
      `expect_out USB 90 ${note.toString(16)} 64`,
    ]),
    "press EDIT",
    "expect_out USB 90 5B 64",
    "release EDIT",
    "expect_out USB 80 5B 00",
    "tapkey 0",
    "expect_out USB 90 63 64",
    "expect_out USB 80 63 00",
    "spin ALGO -1",
    "expect_out USB B0 11 7F",
    "shot panel.png",
    `sysex ${hex(renewed)}`,
    "wait 1100",
    `sysex ${hex(renewed)}`,
    `sysex ${hex(broken)}`,
    "wait 450",
    "expect usb_play_gain 0",
    "usb unplug",
    "usb plug",
    `sysex ${hex(packet(0, 0, []))}`,
    `sysex ${hex(state)}`,
    "wait 150",
    "expect usb_play_gain 3072",
    "usb unplug",
    "wait 30",
    "expect usb_play_gain 0",
  ].join("\n") + "\n",
);
const host = new URL("./dj/build/host/fm1-dj_host", import.meta.url);
const result = spawnSync(decodeURIComponent(host.pathname), [script, dir], {
  stdio: "inherit",
});
console.log(`Simulator results: ${dir}`);
process.exitCode = result.status ?? 1;

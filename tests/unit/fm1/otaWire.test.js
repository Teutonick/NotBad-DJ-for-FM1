import { afterEach, expect, it, vi } from "vitest";
import { pack7, parseFrame, Updater } from "../../../src/fm1/updater/fm1ota.js";

const upgrade = [0xf0, 0x22, 0x24, 0x35, 0x7f, 0xf7];
const image = Uint8Array.from({ length: 64 }, (_, offset) => offset);
const product = "FM-1_82000100";

function wire(cmd, body) {
  let sum = 0;
  for (const byte of body) sum += byte;
  return [
    0xf0,
    ...pack7([0, 0x59, cmd, body.length, 0, 0, ...body, ~sum & 0xff]),
    0xf7,
  ];
}

function identity(product) {
  const bytes = Array.from(product, (character) => character.charCodeAt(0));
  return wire(0x11, [...bytes, ...Array(27 - bytes.length).fill(0)]);
}

function request(address, length) {
  const bytes = [
    0,
    ...Array.from(
      { length: 4 },
      (_, index) => (address >>> (index * 8)) & 0xff,
    ),
    length,
    0,
    0,
  ];
  return wire(0x30, bytes);
}

function rig() {
  const access = { inputs: new Map(), outputs: new Map() };
  const writes = [];
  let portNumber = 0;
  function connect(name, id, onUpgrade, onResponse) {
    const port = ++portNumber;
    const input = Object.assign(new EventTarget(), {
      name,
      state: "connected",
      open: async () => {},
    });
    function emit(data) {
      input.dispatchEvent(Object.assign(new Event("midimessage"), { data }));
    }
    function disconnect() {
      input.state = "disconnected";
      output.state = "disconnected";
      access.inputs.delete(port);
      access.outputs.delete(port);
    }
    const output = {
      name,
      state: "connected",
      open: async () => {},
      send(bytes) {
        if (output.state === "disconnected")
          throw new Error("USB disconnected");
        if (
          bytes.every((byte, index) => byte === upgrade[index]) &&
          bytes.length === upgrade.length
        ) {
          writes.push(name);
          onUpgrade?.(emit, disconnect);
          return;
        }
        const frame = parseFrame(bytes);
        if (frame?.cmd === 0x11) emit(identity(id));
        if (frame?.cmd === 0x30) onResponse?.(frame.body, emit, disconnect);
      },
    };
    access.inputs.set(port, input);
    access.outputs.set(port, output);
    return disconnect;
  }
  const updater = new Updater(access);
  updater.classic = true;
  updater.pause = 0;
  return { connect, updater, writes };
}

afterEach(() => vi.useRealTimers());

it("aborts staging after a lost port without sending an upgrade to another port", async () => {
  vi.useFakeTimers();
  const { connect, updater, writes } = rig();
  connect(
    "FM-1",
    "FM-1_82000000",
    (emit) => emit(request(0, 16)),
    (body, _emit, disconnect) => {
      expect(body.slice(8)).toEqual([...image.slice(0, 16)]);
      disconnect();
    },
  );
  const result = expect(updater.install(image, product)).rejects.toMatchObject({
    code: "lost",
  });
  await vi.runAllTimersAsync();
  await result;
  expect(writes).toEqual(["FM-1"]);
});

it("resumes a lost loader transfer on the known loader and verifies the returned firmware", async () => {
  vi.useFakeTimers();
  const { connect, updater, writes } = rig();
  const chunks = [];
  connect(
    "FM-1",
    "FM-1_82000000",
    (emit) => emit(request(0xe0000000, 8)),
    (_body, _emit, disconnect) => {
      disconnect();
      connect(
        "Felucca Update",
        "ota-FM-1_900",
        (emit) => emit(request(16, 16)),
        (body, _emit, disconnectLoader) => {
          chunks.push(body.slice(8));
          disconnectLoader();
        },
      );
    },
  );
  const interrupted = expect(
    updater.install(image, product),
  ).rejects.toMatchObject({ code: "lost" });
  await vi.runAllTimersAsync();
  await interrupted;
  connect(
    "Felucca Update",
    "ota-FM-1_900",
    (emit) => emit(request(16, 16)),
    (body, emit, disconnectLoader) => {
      if (body[4] === 0xf0) {
        disconnectLoader();
        connect("FM-1 DJ", product);
      } else {
        chunks.push(body.slice(8));
        emit(request(0xf0000000, 8));
      }
    },
  );
  const resumed = expect(
    updater.resume(image, undefined, product),
  ).resolves.toBe(true);
  await vi.runAllTimersAsync();
  await resumed;
  expect(chunks).toEqual(
    [image.slice(16, 32), image.slice(16, 32)].map((bytes) => [...bytes]),
  );
  expect(writes).toEqual(["FM-1", "Felucca Update", "Felucca Update"]);
});

it("refuses a foreign stock loader before sending an upgrade", async () => {
  const { connect, updater, writes } = rig();
  connect("FM-1 OTA", "ota-FM-1_015");
  await expect(updater.resume(image, undefined, product)).rejects.toMatchObject(
    { code: "foreign" },
  );
  expect(writes).toEqual([]);
});

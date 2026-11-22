import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import FirmwarePanel from "../../src/components/FirmwarePanel";
import { I18nContext, translate } from "../../src/i18n/context";
import { pack7 } from "../../src/fm1/updater/fm1ota.js";
import {
  flashSize,
  release,
  verifyBackup,
} from "../../src/fm1/updater/preflight.js";
import { sha256hex } from "../../src/fm1/updater/fm1pkg.js";

vi.mock("../../src/fm1/updater/fm1pkg.js", () => ({
  sha256hex: vi.fn(),
  productOf: () => "FM-1_82000100",
  logicalImage: (bytes) => bytes,
  checkUfw: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function midiDevice(identity, jedec = [0, 0, 0]) {
  const name = "FM-1";
  const input = Object.assign(new EventTarget(), {
    name,
    open: vi.fn(),
    state: "connected",
  });
  const reply = [
    0,
    0x59,
    0x11,
    27,
    0,
    0,
    ...Array.from(identity, (c) => c.charCodeAt(0)),
  ];
  while (reply.length < 30) reply.push(0);
  reply.push(...jedec);
  reply.push(~reply.slice(6).reduce((sum, byte) => sum + byte, 0) & 0xff);
  const output = {
    name,
    state: "connected",
    open: vi.fn(),
    send: vi.fn(() =>
      input.dispatchEvent(
        Object.assign(new Event("midimessage"), {
          data: Uint8Array.from([0xf0, ...pack7(reply), 0xf7]),
        }),
      ),
    ),
  };
  return {
    input,
    output,
    access: { inputs: new Map([[0, input]]), outputs: new Map([[0, output]]) },
  };
}

function setup(hash, access) {
  const request = vi.fn().mockResolvedValue(access);
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", { requestMIDIAccess: request });
  vi.mocked(sha256hex).mockResolvedValue(hash);
  render(
    <I18nContext.Provider
      value={{ t: (key, params) => translate("en", key, params) }}
    >
      <FirmwarePanel busy={false} setBusy={vi.fn()} />
    </I18nContext.Provider>,
  );
  fireEvent.change(screen.getByLabelText("Firmware package (.fwsc)"), {
    target: { files: [new File(["test"], "release.fwsc")] },
  });
  return request;
}

it("rejects a package with a different digest without requesting MIDI", async () => {
  const request = setup("different");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "original FM-1 DJ",
  );
  expect(request).not.toHaveBeenCalled();
});

it.each(["FM-1_82000100", "ota-FM-1_900"])(
  "only sends a read-only handshake to %s and offers no write",
  async (id) => {
    const { input, output, access } = midiDevice(
      id,
      id.startsWith("ota-") ? undefined : [0xb3, 0x60, 0x14],
    );
    const existing = vi.fn();
    input.onmidimessage = existing;
    const request = setup(release.sha256, access);
    await screen.findByText("Verified FM-1 DJ 0.1.0 release package.");
    fireEvent.change(screen.getByLabelText("JEDEC ID from Device Info"), {
      target: { value: "0x000000" },
    });
    expect(
      screen.getByText("Unknown JEDEC ID. Installation is blocked."),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText("JEDEC ID from Device Info"), {
      target: { value: "0xb36014" },
    });
    expect(screen.getByText("Recognized chip: UCUN UC25HQ80.")).toBeVisible();
    expect(release.verifiedConfigurations).toEqual([]);
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Read MIDI identity" }));
    expect(
      await screen.findByText("MIDI identity: " + id, { exact: false }),
    ).toBeVisible();
    expect(
      screen.getByText("MIDI identity: " + id, { exact: false }),
    ).toHaveTextContent(
      id.startsWith("ota-")
        ? "did not report a JEDEC ID"
        : "JEDEC 0xB36014 (UCUN UC25HQ80)",
    );
    expect(request).toHaveBeenCalledWith({ sysex: true });
    expect(output.send.mock.calls).toEqual([
      [[0xf0, 0, 0x32, 0x45, 0, 0, 0, 0x40, 0x7f, 0xf7]],
    ]);
    expect(input.onmidimessage).toBe(existing);
    expect(
      screen.queryByRole("button", { name: /install|rollback/i }),
    ).not.toBeInTheDocument();
  },
);

it("does not report a controller as connected when USB drops during probing", async () => {
  const { input, output, access } = midiDevice("FM-1_82000100");
  const reply = output.send.getMockImplementation();
  output.send.mockImplementation(() => {
    reply();
    input.state = "disconnected";
  });
  setup(release.sha256, access);
  await screen.findByText("Verified FM-1 DJ 0.1.0 release package.");
  fireEvent.click(screen.getByRole("button", { name: "Read MIDI identity" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("No FM-1 identity"),
  );
  expect(output.send).toHaveBeenCalledTimes(1);
});

it("requires two complete, identical and nonblank dumps before reporting a hash", async () => {
  const first = new Uint8Array(flashSize);
  first[0] = 123;
  const dump = (bytes) => new File([bytes], "flash.bin");
  const full = dump(first);
  vi.mocked(sha256hex).mockResolvedValue("hash");
  expect(await verifyBackup([full, full])).toBeNull();
  expect(await verifyBackup([full, dump(first.subarray(1))])).toBeNull();
  expect(
    await verifyBackup([full, dump(new Uint8Array(flashSize))]),
  ).toBeNull();
  expect(
    await verifyBackup([
      dump(new Uint8Array(flashSize)),
      dump(new Uint8Array(flashSize)),
    ]),
  ).toBeNull();
  expect(sha256hex).not.toHaveBeenCalled();
  expect(await verifyBackup([full, dump(first)])).toBe("hash");
});

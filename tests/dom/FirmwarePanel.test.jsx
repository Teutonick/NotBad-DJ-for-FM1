import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import FirmwarePanel from "../../src/components/FirmwarePanel";
import { I18nContext, translate } from "../../src/i18n/context";
import { sha256hex } from "../../src/fm1/updater/fm1pkg.js";

vi.mock("../../src/fm1/updater/fm1pkg.js", () => ({
  sha256hex: vi.fn(),
  productOf: () => "FM-1_82000100",
  logicalImage: (bytes) => bytes,
  checkUfw: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(hash) {
  const request = vi.fn().mockRejectedValue(new Error("MIDI denied"));
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", { requestMIDIAccess: request });
  vi.mocked(sha256hex).mockResolvedValue(hash);
  render(
    <I18nContext.Provider value={{ t: (key) => translate("en", key) }}>
      <FirmwarePanel busy={false} setBusy={vi.fn()} />
    </I18nContext.Provider>,
  );
  const file = new File(["test"], "release.fwsc");
  fireEvent.change(screen.getByLabelText("Firmware package (.fwsc)"), {
    target: { files: [file] },
  });
  const button = screen.getByRole("button", { name: "Install FM-1 DJ 0.1.0" });
  return { request, button };
}

it("rejects a package with a different digest before requesting MIDI", async () => {
  const { request, button } = setup("different");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "original FM-1 DJ",
  );
  expect(button).toBeDisabled();
  expect(request).not.toHaveBeenCalled();
});

it("requires every acknowledgment and the final confirmation before requesting SysEx", async () => {
  const { request, button } = setup(
    "7e567d7950c2a4c601933697d3f33bcaaa38d7d1e2735e2c2734aca773b07330",
  );
  await screen.findByText("Verified FM-1 DJ 0.1.0 release package.");
  const confirmations = screen.getAllByRole("checkbox");
  expect(confirmations).toHaveLength(4);
  for (const confirmation of confirmations) {
    expect(button).toBeDisabled();
    fireEvent.click(confirmation);
  }
  const confirm = vi
    .spyOn(window, "confirm")
    .mockReturnValueOnce(false)
    .mockReturnValueOnce(true);
  fireEvent.click(button);
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(button);
  await waitFor(() => expect(request).toHaveBeenCalledWith({ sysex: true }));
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(await screen.findByRole("alert")).toHaveTextContent("MIDI denied");
});

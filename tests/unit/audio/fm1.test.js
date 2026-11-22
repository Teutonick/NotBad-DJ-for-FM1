import { describe, expect, it } from "vitest";
import { isSeparateOutput } from "../../../src/audio/cueOutput";
import {
  phaseAlignedPosition,
  packet,
  fourteen,
  shortTitle,
} from "../../../src/fm1/protocol";

describe("FM-1 DJ integration", () => {
  it("only accepts explicit headphones on a separate physical device group", () => {
    const devices = [
      { deviceId: "default", groupId: "mac" },
      { deviceId: "mac-speakers", groupId: "mac" },
      { deviceId: "fm1", groupId: "controller" },
    ];
    expect(isSeparateOutput(devices, "fm1", "")).toBe(true);
    expect(isSeparateOutput(devices, "mac-speakers", "")).toBe(false);
    expect(isSeparateOutput(devices, "default", "fm1")).toBe(false);
    expect(isSeparateOutput(devices, "fm1", "fm1")).toBe(false);
    expect(isSeparateOutput(devices.slice(0, 2), "fm1", "")).toBe(false);
  });

  it("matches the leader beat phase within the follower track", () => {
    const target = phaseAlignedPosition(12, 0.2, 128, 8.75, 0.1, 124, 26);
    expect(((target - 0.2) * 128) / 60 - ((8.75 - 0.1) * 124) / 60).toBeCloseTo(
      7,
    );
    expect(target).toBeGreaterThan(0);
    expect(target).toBeLessThan(26);
  });

  it("emits a versioned frame with bounded payload and checksum", () => {
    const data = [...fourteen(1240), ...shortTitle("Échos ♫")];
    const frame = packet(1, 129, data);
    expect(frame.slice(0, 7)).toEqual([240, 125, 70, 68, 1, 1, 1]);
    expect(frame.at(-1)).toBe(247);
    expect(frame.slice(1, -1).reduce((sum, byte) => sum + byte, 0) % 128).toBe(
      0,
    );
    expect(frame.slice(1, -1).every((byte) => byte < 128)).toBe(true);
  });
});

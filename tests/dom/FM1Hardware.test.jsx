import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import Hardware from "../../src/fm1/Hardware";
import { packet } from "../../src/fm1/protocol";

class Port extends EventTarget {
  constructor(id, name) {
    super();
    this.id = id;
    this.name = name;
    this.state = "connected";
    this.send = vi.fn();
  }
  receive(data) {
    const event = new Event("midimessage");
    event.data = Uint8Array.from(data);
    this.dispatchEvent(event);
  }
}

function setup(input, ...outputs) {
  const access = Object.assign(new EventTarget(), {
    inputs: new Map([[input.id, input]]),
    outputs: new Map(outputs.map((port) => [port.id, port])),
  });
  const request = vi.fn(async () => access);
  vi.stubGlobal(
    "navigator",
    Object.assign(Object.create(navigator), { requestMIDIAccess: request }),
  );
  const onMidi = vi.fn();
  const engine = { resume: () => new Promise(() => {}), ctx: {} };
  function Fixtures() {
    const [config, setConfig] = useState({});
    return (
      <Hardware
        engine={engine}
        config={config}
        setConfig={setConfig}
        onMidi={onMidi}
        getPacket={() => [15]}
      />
    );
  }
  render(<Fixtures />);
  return { request, access, onMidi };
}

afterEach(() => vi.unstubAllGlobals());

it("pairs different Windows suffixes and waits for valid firmware before forwarding MIDI", async () => {
  const input = new Port("input", "FM-1 DJ 1");
  const output = new Port("output", "FM-1 DJ 2");
  const { access, request, onMidi } = setup(input, output);
  await act(async () => fireEvent.click(screen.getByText("Connect FM-1")));
  expect(request).toHaveBeenCalledWith({ sysex: true });
  expect(output.send).toHaveBeenCalledWith(packet(0, 0, []));
  const reply = packet(2, 0, [0, 1, 0]);
  const note = [0x90, 53, 100];
  act(() => input.receive(note));
  act(() => input.receive([...reply.slice(0, -1), 0]));
  expect(onMidi).not.toHaveBeenCalled();
  expect(output.send).toHaveBeenCalledTimes(1);
  act(() => input.receive(reply));
  expect(screen.getByText("MIDI connected")).toBeTruthy();
  expect(output.send).toHaveBeenLastCalledWith(packet(1, 0, [15]));
  act(() => input.receive(note));
  expect(onMidi).toHaveBeenLastCalledWith(note);

  act(() => {
    output.state = "disconnected";
    access.dispatchEvent(new Event("statechange"));
  });
  expect(onMidi).toHaveBeenLastCalledWith([]);
  expect(screen.queryByText("MIDI connected")).toBeNull();
  act(() => {
    output.state = "connected";
    access.dispatchEvent(new Event("statechange"));
  });
  expect(output.send).toHaveBeenLastCalledWith(packet(0, 0, []));
  act(() => input.receive(reply));
  expect(screen.getByText("MIDI connected")).toBeTruthy();
});

it("lets the user select an output when several Windows ports share the same name", async () => {
  const input = new Port("input", "FM-1 DJ 1");
  const wrong = new Port("out2", "FM-1 DJ 2");
  const correct = new Port("out3", "FM-1 DJ 3");
  setup(input, wrong, correct);
  await act(async () => fireEvent.click(screen.getByText("Connect FM-1")));
  fireEvent.click(screen.getByText("Hardware diagnostics"));
  expect(wrong.send).not.toHaveBeenCalled();
  expect(correct.send).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("MIDI output"), {
    target: { value: "out3" },
  });
  expect(correct.send).toHaveBeenCalledWith(packet(0, 0, []));
  act(() => input.receive(packet(2, 0, [0, 1, 0])));
  expect(screen.getByText("Firmware 0.1.0")).toBeTruthy();
  expect(wrong.send).not.toHaveBeenCalled();
});

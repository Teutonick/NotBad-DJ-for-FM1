import { useEffect, useRef, useState } from "react";
import { firmwareVersion, packet } from "./protocol";
import { selectInput, selectOutput } from "./midiPorts";
import { testTone } from "../audio/cueOutput";

export default function Hardware({
  engine,
  onMidi,
  getPacket,
  config,
  setConfig,
  cueRef,
}) {
  const [access, setAccess] = useState(null);
  const [ports, setPorts] = useState({ inputs: [], outputs: [] });
  const [status, setStatus] = useState("");
  const [monitor, setMonitor] = useState([]);
  const [verified, setVerified] = useState(null);
  const [mapping, setMapping] = useState(() =>
    JSON.stringify(config.noteMap || {}),
  );
  const [expanded, setExpanded] = useState(false);
  const latest = useRef({ onMidi, getPacket, expanded });
  latest.current = { onMidi, getPacket, expanded };

  async function connect() {
    try {
      // Grant audio activation without making MIDI discovery wait for an audio device.
      Promise.resolve(engine.resume()).catch(() => {});
      setAccess(await navigator.requestMIDIAccess({ sysex: true }));
      setStatus("");
    } catch (error) {
      setStatus(`MIDI permission or device unavailable (${error.message})`);
    }
  }

  useEffect(() => {
    if (!access) return;
    const connected = (list) =>
      [...list.values()].filter((port) => port.state === "connected");
    const update = () =>
      setPorts({
        inputs: connected(access.inputs),
        outputs: connected(access.outputs),
      });
    access.addEventListener("statechange", update);
    update();
    return () => access.removeEventListener("statechange", update);
  }, [access]);

  const input = selectInput(ports.inputs, config.midiInput);
  const output = selectOutput(ports.outputs, input, config.midiOutput);
  const firmware =
    verified?.input === input && verified?.output === output
      ? verified?.version
      : undefined;

  useEffect(() => {
    if (!input || !output) return;
    let sequence = 0;
    let nextFrame;
    let acknowledged = false;
    let sentGreeting = false;
    let lastGreeting = -Infinity;
    const send = (bytes) => {
      if (input.state !== "connected" || output.state !== "connected")
        return false;
      try {
        output.send(bytes);
        return true;
      } catch {
        return false;
      }
    };
    const sendState = () =>
      send(packet(1, sequence++, latest.current.getPacket()));
    const tick = () => {
      if (acknowledged) {
        sendState();
      } else if (performance.now() - lastGreeting >= 750) {
        lastGreeting = performance.now();
        sentGreeting = send(packet(0, 0, [])) || sentGreeting;
      }
    };
    const receive = (event) => {
      const bytes = [...event.data];
      if (latest.current.expanded)
        setMonitor((prev) => [
          ...prev.slice(-11),
          bytes.map((n) => n.toString(16).padStart(2, "0")).join(" "),
        ]);
      if (!acknowledged) {
        const version = sentGreeting && firmwareVersion(bytes);
        if (!version) return;
        acknowledged = true;
        setVerified({ input, output, version });
        sendState();
        return;
      }
      if (bytes[0] === 0xf0) return;
      latest.current.onMidi(bytes);
      if (nextFrame == null)
        nextFrame = requestAnimationFrame(() => {
          nextFrame = null;
          sendState();
        });
    };
    input.addEventListener("midimessage", receive);
    const timer = setInterval(tick, 125);
    tick();
    return () => {
      input.removeEventListener("midimessage", receive);
      clearInterval(timer);
      if (nextFrame != null) cancelAnimationFrame(nextFrame);
      setVerified(null);
      latest.current.onMidi([]);
    };
  }, [input, output]);

  function saveMapping() {
    try {
      const parsed = JSON.parse(mapping);
      const note = (number) =>
        Number.isInteger(number) && number >= 53 && number <= 87;
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        Object.entries(parsed).some(
          ([from, to]) => !note(Number(from)) || !note(to),
        )
      ) {
        throw new Error(
          "Use a JSON object mapping MIDI notes 53–87 to notes 53–87.",
        );
      }
      setConfig((prev) => ({ ...prev, noteMap: parsed }));
      setStatus("MIDI mapping saved");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function outputTest(cue) {
    try {
      if (cue) await cueRef.current?.test();
      else {
        await engine.resume();
        if (typeof engine.ctx.setSinkId === "function")
          await engine.setMasterSink(config.masterOut || "");
        testTone(engine.ctx, engine.ctx.destination, 440);
      }
      setStatus("");
    } catch (error) {
      setStatus(error.message);
    }
  }

  return (
    <section className="fm-hardware" aria-label="FM-1 hardware">
      <button type="button" onClick={connect}>
        {firmware ? "MIDI connected" : "Connect FM-1"}
      </button>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        Hardware diagnostics
      </button>
      <span role="status">
        {status ||
          (firmware
            ? input.name
            : access &&
              (!input
                ? "Select the FM-1 MIDI input in Hardware diagnostics."
                : !output
                  ? "Select the FM-1 MIDI output in Hardware diagnostics."
                  : "Waiting for FM-1 DJ firmware to confirm the MIDI pair."))}
      </span>
      {expanded && (
        <div className="fm-diagnostics">
          {[
            ["MIDI input", "midiInput", ports.inputs],
            ["MIDI output", "midiOutput", ports.outputs],
          ].map(([label, key, devices]) => (
            <label key={key}>
              {label}{" "}
              <select
                value={config[key] || ""}
                onChange={(event) => {
                  const value = event.target.value;
                  setConfig((prev) => ({ ...prev, [key]: value }));
                }}
              >
                <option value="">FM-1 DJ auto-select</option>
                {config[key] &&
                  !devices.some((port) => port.id === config[key]) && (
                    <option value={config[key]}>
                      Previously selected port unavailable
                    </option>
                  )}
                {devices.map((port) => (
                  <option key={port.id} value={port.id}>
                    {port.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <span>Firmware {firmware || "—"}</span>
          <button onClick={() => outputTest(false)}>Test Master</button>
          <button onClick={() => outputTest(true)}>Test headphones</button>
          <span>
            {engine.ctx.sampleRate} Hz · Master audio latency{" "}
            {Math.round(
              1000 * (engine.ctx.baseLatency + (engine.ctx.outputLatency || 0)),
            )}{" "}
            ms
          </span>
          <label>
            SYNC phase{" "}
            <input
              type="checkbox"
              checked={config.phaseSync !== false}
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, phaseSync: e.target.checked }))
              }
            />
          </label>
          <label>
            MIDI note map{" "}
            <input
              value={mapping}
              onChange={(e) => setMapping(e.target.value)}
              placeholder='{"53":68}'
            />
          </label>
          <button onClick={saveMapping}>Save mapping</button>
          <pre aria-label="MIDI monitor">{monitor.join("\n")}</pre>
        </div>
      )}
    </section>
  );
}

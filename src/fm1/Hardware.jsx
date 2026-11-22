import { useEffect, useRef, useState } from "react";
import { packet } from "./protocol";
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
  const [ports, setPorts] = useState([]);
  const [selected, setSelected] = useState("");
  const [status, setStatus] = useState("");
  const [monitor, setMonitor] = useState([]);
  const [firmware, setFirmware] = useState("");
  const [mapping, setMapping] = useState(() =>
    JSON.stringify(config.noteMap || {}),
  );
  const [expanded, setExpanded] = useState(false);
  const latest = useRef({ onMidi, getPacket, expanded });
  latest.current = { onMidi, getPacket, expanded };

  async function connect() {
    try {
      await engine.resume();
      setAccess(await navigator.requestMIDIAccess({ sysex: true }));
      setStatus("");
    } catch (error) {
      setStatus(`MIDI permission or device unavailable (${error.message})`);
    }
  }

  useEffect(() => {
    if (!access) return;
    const update = () =>
      setPorts(
        [...access.inputs.values()].filter((p) => p.state === "connected"),
      );
    access.addEventListener("statechange", update);
    update();
    return () => access.removeEventListener("statechange", update);
  }, [access]);

  const input =
    ports.find((port) => port.id === selected) ||
    (!selected && ports.find((port) => /fm[ -]?1 dj/i.test(port.name || "")));

  useEffect(() => {
    if (!access || !input) return;
    let sequence = 0;
    let out;
    let nextFrame;
    const reset = () => {
      out = [...access.outputs.values()].find(
        (port) =>
          port.state === "connected" &&
          port.name === input.name &&
          port.manufacturer === input.manufacturer,
      );
      try {
        out?.send(packet(0, 0, []));
      } catch {
        /* disconnected during enumeration */
      }
    };
    reset();
    access.addEventListener("statechange", reset);
    const receive = (event) => {
      const bytes = [...event.data];
      if (latest.current.expanded)
        setMonitor((prev) => [
          ...prev.slice(-11),
          bytes.map((n) => n.toString(16).padStart(2, "0")).join(" "),
        ]);
      if (bytes[0] === 0xf0) {
        if (
          bytes.length === 12 &&
          bytes[1] === 0x7d &&
          bytes[2] === 0x46 &&
          bytes[3] === 0x44 &&
          bytes[4] === 1 &&
          bytes[5] === 2 &&
          bytes.slice(1, -1).reduce((sum, byte) => sum + byte, 0) % 128 === 0
        ) {
          setFirmware(bytes.slice(7, 10).join("."));
        }
        return;
      }
      latest.current.onMidi(bytes);
      if (nextFrame == null)
        nextFrame = requestAnimationFrame(() => {
          nextFrame = null;
          sendState();
        });
    };
    const sendState = () => {
      try {
        out?.send(packet(1, sequence++, latest.current.getPacket()));
      } catch {
        /* port disconnected */
      }
    };
    input.addEventListener("midimessage", receive);
    const timer = setInterval(sendState, 125);
    return () => {
      input.removeEventListener("midimessage", receive);
      access.removeEventListener("statechange", reset);
      clearInterval(timer);
      if (nextFrame != null) cancelAnimationFrame(nextFrame);
      latest.current.onMidi([]);
    };
  }, [access, input]);

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
        {input ? "MIDI connected" : "Connect FM-1"}
      </button>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        Hardware diagnostics
      </button>
      <span role="status">
        {status || input?.name || (access ? "Waiting for FM-1" : "")}
      </span>
      {expanded && (
        <div className="fm-diagnostics">
          <label>
            MIDI device{" "}
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">FM-1 DJ auto-select</option>
              {ports.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <span>Firmware {input && firmware ? firmware : "—"}</span>
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

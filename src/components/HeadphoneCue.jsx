import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { CueOutput, testTone } from "../audio/cueOutput";

export default forwardRef(function HeadphoneCue(
  { engine, cueDeviceId, masterDeviceId },
  ref,
) {
  const output = useMemo(() => new CueOutput(engine), [engine]);
  const [ready, setReady] = useState(false);
  const [pfl, setPfl] = useState({ A: false, B: false });
  const [volume, setVolume] = useState(0.35);
  const [mix, setMix] = useState(0);
  const [status, setStatus] = useState("");
  const mixRef = useRef(mix);

  useEffect(() => {
    const lost = () => {
      output.mute();
      engine.setDeckCue("A", false);
      engine.setDeckCue("B", false);
      setPfl({ A: false, B: false });
      setReady(false);
      setStatus(
        cueDeviceId
          ? "Enable the selected headphones output."
          : "Choose headphones in audio settings.",
      );
    };
    lost();
    navigator.mediaDevices?.addEventListener("devicechange", lost);
    return () => {
      navigator.mediaDevices?.removeEventListener("devicechange", lost);
      output.mute();
    };
  }, [output, engine, cueDeviceId, masterDeviceId]);

  function toggle(side) {
    if (!ready) return;
    setPfl((prev) => {
      engine.setDeckCue(side, !prev[side]);
      return { ...prev, [side]: !prev[side] };
    });
  }

  function adjustMix(value) {
    const next = Math.min(1, Math.max(0, value));
    mixRef.current = next;
    setMix(next);
    engine.setCueMix(next);
  }

  async function enable() {
    setReady(false);
    try {
      const connected = await output.connect(cueDeviceId, masterDeviceId);
      setReady(connected);
      if (connected) setStatus("Headphones ready");
      return connected;
    } catch (error) {
      setStatus(error.message);
      return false;
    }
  }

  useImperativeHandle(ref, () => ({
    toggle,
    pfl,
    adjustMix: (delta) => adjustMix(mixRef.current + delta),
    test: async () => {
      if (!(await enable())) throw new Error("Headphones output unavailable.");
      output.testSource = testTone(output.context, output.gate, 660);
      output.testSource.onended = () => {
        output.testSource = null;
      };
    },
  }));

  return (
    <section className="fm-hardware fm-headphones" aria-label="Headphones">
      <strong>HEADPHONES</strong>
      <button type="button" onClick={enable} disabled={ready}>
        Enable Cue Output
      </button>
      {["A", "B"].map((side) => (
        <button
          key={side}
          type="button"
          disabled={!ready}
          aria-pressed={pfl[side]}
          onClick={() => toggle(side)}
        >
          PFL {side}
        </button>
      ))}
      <label>
        Level{" "}
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={(event) => {
            const next = Number(event.target.value);
            setVolume(next);
            engine.setCueVolume(next);
          }}
        />
      </label>
      <label>
        Cue / Master{" "}
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={mix}
          onChange={(event) => adjustMix(Number(event.target.value))}
        />
      </label>
      <span role="status">{status}</span>
    </section>
  );
});

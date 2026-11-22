export function isSeparateOutput(devices, cueId, masterId) {
  const cue = devices.find((device) => device.deviceId === cueId);
  const master = devices.find(
    (device) => device.deviceId === (masterId || "default"),
  );
  return Boolean(
    cue &&
    master &&
    cueId !== "default" &&
    cueId !== "communications" &&
    cueId !== master.deviceId &&
    cue.groupId &&
    master.groupId &&
    cue.groupId !== master.groupId,
  );
}

export class CueOutput {
  constructor(engine) {
    this.engine = engine;
    this.generation = 0;
  }

  mute() {
    this.generation += 1;
    this.testSource?.stop();
    this.testSource = null;
    if (this.gate) this.gate.gain.value = 0;
  }

  async connect(cueId, masterId) {
    this.mute();
    const generation = this.generation;
    if (!cueId) return false;
    if (!this.context) {
      this.context = new AudioContext({ sinkId: { type: "none" } });
      this.gate = this.context.createGain();
      this.gate.gain.value = 0;
      this.context
        .createMediaStreamSource(this.engine.getCueStream())
        .connect(this.gate);
      this.gate.connect(this.context.destination);
    }
    await Promise.all([this.engine.resume(), this.context.resume()]);
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === "audiooutput",
    );
    if (this.generation !== generation) return false;
    if (
      this.engine.ctx.sinkId !== (masterId || "") ||
      !isSeparateOutput(devices, cueId, masterId)
    ) {
      throw new Error("Choose and authorize a separate headphones output.");
    }
    await this.context.setSinkId(cueId);
    if (this.generation !== generation) return false;
    this.gate.gain.value = 1;
    return true;
  }
}

export function testTone(context, destination, frequency) {
  const oscillator = context.createOscillator();
  const level = context.createGain();
  const now = context.currentTime;
  oscillator.frequency.value = frequency;
  level.gain.setValueAtTime(0, now);
  level.gain.linearRampToValueAtTime(0.06, now + 0.025);
  level.gain.setValueAtTime(0.06, now + 0.32);
  level.gain.linearRampToValueAtTime(0, now + 0.42);
  oscillator.connect(level).connect(destination);
  oscillator.start();
  oscillator.stop(now + 0.43);
  return oscillator;
}

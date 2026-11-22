const HEADER = [0x7d, 0x46, 0x44, 1];

export function packet(type, sequence, payload) {
  const bytes = [...HEADER, type, sequence & 127, ...payload];
  const checksum = -bytes.reduce((sum, byte) => sum + byte, 0) & 127;
  return [0xf0, ...bytes, checksum, 0xf7];
}

export function firmwareVersion(bytes) {
  if (
    bytes.length !== 12 ||
    bytes[0] !== 0xf0 ||
    bytes[11] !== 0xf7 ||
    !HEADER.every((byte, index) => byte === bytes[index + 1]) ||
    bytes[5] !== 2 ||
    bytes[6] !== 0
  )
    return;
  const body = bytes.slice(1, -1);
  if (
    body.some((byte) => byte > 127) ||
    body.reduce((sum, byte) => sum + byte, 0) % 128 !== 0
  )
    return;
  return bytes.slice(7, 10).join(".");
}

export const fourteen = (n) => [n & 127, (n >> 7) & 127];
export const unit = (n) => Math.round(Math.max(0, Math.min(1, n || 0)) * 127);
export const shortTitle = (name = "") =>
  Array.from(
    name
      .normalize("NFKD")
      .replace(/\p{Mark}/gu, "")
      .replace(/[^ -~]/g, "?")
      .slice(0, 20)
      .padEnd(20),
    (character) => character.charCodeAt(0),
  );

export function phaseAlignedPosition(
  position,
  anchor,
  bpm,
  reference,
  referenceAnchor,
  referenceBpm,
  duration,
) {
  const beat = 60 / bpm;
  const referenceBeats = ((reference - referenceAnchor) * referenceBpm) / 60;
  const phase = ((referenceBeats % 1) + 1) % 1;
  const origin = anchor + phase * beat;
  const nearest = Math.round((position - origin) / beat);
  const first = Math.ceil(-origin / beat);
  const last = Math.floor((duration - 0.02 - origin) / beat);
  return first <= last
    ? origin + Math.max(first, Math.min(last, nearest)) * beat
    : position;
}

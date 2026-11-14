// Cuentas del SYNC continuo: a qué BPM tiene que ir un deck y con qué pitch.
//
// `state` = { bpms: {A, B}, pitch: {A, B}, masterSyncOn, masterBpm }: los BPM
// son los de la pista (sin pitch) y el pitch va en %.

const otherSide = (side) => (side === "A" ? "B" : "A");

/** BPM al que tiene que ir `side`: el del master o el EFECTIVO del otro deck. */
export function syncTargetBpm(side, { bpms, pitch, masterSyncOn, masterBpm }) {
  if (masterSyncOn) return masterBpm || null;
  const other = otherSide(side);
  if (!bpms[other]) return null;
  return bpms[other] * (1 + pitch[other] / 100);
}

/**
 * Pitch que lleva `ownBpm` a `targetBpm`. Si no cabe en el rango actual, el
 * rango se ensancha al primero de `ranges` que sirva (o al mayor, y el pitch
 * se queda en el tope). Nunca estrecha: el rango de ⚙ es el de PARTIDA.
 */
export function computeSyncPitch({ ownBpm, targetBpm, currentRange, ranges }) {
  const wanted = (targetBpm / ownBpm - 1) * 100;
  let range = currentRange;
  if (Math.abs(wanted) > range) {
    range =
      ranges.find((r) => r >= Math.abs(wanted)) ?? ranges[ranges.length - 1];
  }
  return { pitch: Math.max(-range, Math.min(range, wanted)), range };
}

/** ¿Se puede activar el SYNC en `side`? BPM propio y algo a lo que seguir. */
export function canSync(side, { bpms, masterSyncOn }) {
  return Boolean(bpms[side] && (masterSyncOn || bpms[otherSide(side)]));
}

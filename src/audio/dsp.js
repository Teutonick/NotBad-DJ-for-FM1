// Piezas de procesado de señal que comparten los análisis (forma de onda,
// tonalidad, medidores) y el motor. Aritmética EXACTA de la que había en cada
// sitio: cambiarla movería los resultados del análisis.

/** Coeficiente del filtro paso bajo de un polo para `freq` Hz: dt/(rc+dt). */
export function onePoleAlpha(freq, sampleRate) {
  const rc = 1 / (2 * Math.PI * freq);
  const dt = 1 / sampleRate;
  return dt / (rc + dt);
}

/** Datos de los primeros `max` canales de un AudioBuffer. */
export function getChannels(audioBuffer, max = 2) {
  const n = Math.min(max, audioBuffer.numberOfChannels);
  const out = [];
  for (let c = 0; c < n; c++) out.push(audioBuffer.getChannelData(c));
  return out;
}

/** Módulo siempre positivo (el % de JS conserva el signo). */
export function mod(x, n) {
  return ((x % n) + n) % n;
}

/** Ganancia lineal → dB (20·log10). */
export function gainToDb(gain) {
  return 20 * Math.log10(gain);
}

/** dB → ganancia lineal. */
export function dbToGain(db) {
  return Math.pow(10, db / 20);
}

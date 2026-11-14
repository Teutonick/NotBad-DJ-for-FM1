// Qué trozo de la pista enseña la onda grande, en fracciones 0..1.
//
// La ventana mide 1/zoom de la pista y sigue SIEMPRE a la reproducción, con
// el playhead a un tercio, sin salirse por el principio ni por el final. Sin
// duración todavía empieza en el principio. Es el mismo cálculo al dibujar y
// al convertir un clic en una posición: por eso vive en un solo sitio.
const CURSOR_AT = 1 / 3;

export function computeWaveWindow({ total, zoom, curFrac, hasDuration }) {
  const visible = Math.max(1, Math.floor(total / zoom)); // en muestras
  const windowFrac = visible / total;
  let leftFrac = 0;
  if (hasDuration) {
    leftFrac = curFrac - CURSOR_AT * windowFrac;
    if (leftFrac < 0) leftFrac = 0;
    if (leftFrac > 1 - windowFrac) leftFrac = 1 - windowFrac;
  }
  return { visible, windowFrac, leftFrac, rightFrac: leftFrac + windowFrac };
}

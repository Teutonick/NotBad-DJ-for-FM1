// Ajusta el tamaño interno de un <canvas> al que ocupa en pantalla.
//
// La REGLA DE ORO de los canvas de la app: `canvas.width` guarda ENTEROS. Si
// se compara con un ancho fraccionario (getBoundingClientRect casi nunca da un
// número redondo) la condición no se cumple nunca y el lienzo se reasigna —se
// reinicia entero— en cada frame, que cuesta más que dibujarlo. Por eso se
// redondea siempre, y solo se toca el lienzo si de verdad cambia.
//
// `fallbackW/H`: tamaño a usar mientras el elemento aún mide 0 (sin layout).
// `dpr`: densidad de píxeles, para lienzos que se pintan a resolución nativa.
export function fitCanvas(
  canvas,
  rect,
  { fallbackW = 0, fallbackH = 0, dpr = 1 } = {},
) {
  const w = Math.max(1, Math.round((rect.width || fallbackW) * dpr));
  const h = Math.max(1, Math.round((rect.height || fallbackH) * dpr));
  const resized = canvas.width !== w || canvas.height !== h;
  if (resized) {
    canvas.width = w;
    canvas.height = h;
  }
  return { w, h, resized };
}

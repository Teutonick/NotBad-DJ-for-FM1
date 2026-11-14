// Descarga un Blob como archivo con el nombre que se le dé (en la app de
// escritorio abre el diálogo nativo de guardado). La URL se suelta un rato
// después, no al momento: el navegador aún tiene que leerla para guardar.
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

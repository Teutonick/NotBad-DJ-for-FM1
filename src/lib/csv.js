// Una línea de CSV (RFC 4180): el campo que lleva el separador, comillas o un
// salto de línea va entre comillas, con las comillas de dentro duplicadas. Si
// no, un título como «Song; Remix» descoloca todas las columnas de la fila.
export function csvField(value, sep = ";") {
  const s = value == null ? "" : String(value);
  if (s.includes(sep) || /["\r\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

export function csvLine(fields, sep = ";") {
  return fields.map((f) => csvField(f, sep)).join(sep);
}

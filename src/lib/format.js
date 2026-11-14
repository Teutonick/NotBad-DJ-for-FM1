// Nombre de archivo sin la última extensión: «mi.tema.mp3» → «mi.tema».
// Sin punto (o con el punto solo al principio, «.mp3») se deja entero: antes
// un archivo sin extensión se quedaba en "" y la pantalla decía «Sin archivo».
export function stripExtension(name) {
  const s = name == null ? "" : String(name);
  const dot = s.lastIndexOf(".");
  return dot > 0 ? s.slice(0, dot) : s;
}

// Reloj mm:ss (o hh:mm:ss a partir de la hora, si `hours`). Sin un número da
// `fallback`; lo negativo cuenta como cero. El deck enseña horas; la lista y
// el contador de grabación siguen contando minutos («75:00»), como siempre.
export function formatClock(
  seconds,
  { fallback = "00:00", hours = true } = {},
) {
  if (!Number.isFinite(seconds)) return fallback;
  const total = Math.max(0, Math.floor(seconds));
  const pad = (v) => String(v).padStart(2, "0");
  const ss = pad(total % 60);
  if (hours && total >= 3600) {
    return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${ss}`;
  }
  return `${pad(Math.floor(total / 60))}:${ss}`;
}

// Tamaño de archivo en MB con un decimal; sin número, vacío
export function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

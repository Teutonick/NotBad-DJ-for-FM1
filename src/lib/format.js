// Nombre de archivo sin la última extensión: «mi.tema.mp3» → «mi.tema».
// Sin punto (o con el punto solo al principio, «.mp3») se deja entero: antes
// un archivo sin extensión se quedaba en "" y la pantalla decía «Sin archivo».
export function stripExtension(name) {
  const s = name == null ? "" : String(name);
  const dot = s.lastIndexOf(".");
  return dot > 0 ? s.slice(0, dot) : s;
}

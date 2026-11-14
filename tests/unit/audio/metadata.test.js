import { describe, it, expect, vi } from "vitest";

// La librería se carga con import() dinámico. La primera carga falla (en la
// web: chunk viejo que da 404 tras desplegar una versión nueva) y la segunda
// funciona.
const state = vi.hoisted(() => ({ loads: 0 }));
vi.mock("music-metadata", () => {
  state.loads += 1;
  if (state.loads === 1) throw new Error("chunk 404");
  return {
    parseBlob: async () => ({ common: { artist: " Artista ", title: "Tema" } }),
  };
});

const { readTrackMetadata } = await import("../../../src/audio/metadata.js");

describe("readTrackMetadata", () => {
  it("si la librería no carga una vez, lo vuelve a intentar en la siguiente pista", async () => {
    const file = new Blob(["x"]);
    const first = await readTrackMetadata(file);
    expect(first).toEqual({
      artist: null,
      title: null,
      album: null,
      artwork: null,
    });

    const second = await readTrackMetadata(file);
    expect(second).toMatchObject({ artist: "Artista", title: "Tema" });
  });
});

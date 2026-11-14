import { describe, it, expect, vi, afterEach } from "vitest";
import { downloadBlob } from "../../src/lib/download";

// jsdom no trae createObjectURL/revokeObjectURL
const antes = { crear: URL.createObjectURL, revocar: URL.revokeObjectURL };
afterEach(() => {
  URL.createObjectURL = antes.crear;
  URL.revokeObjectURL = antes.revocar;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("downloadBlob", () => {
  it("descarga el blob con su nombre y suelta la URL un rato después", () => {
    vi.useFakeTimers();
    const blob = new Blob(["hola"]);
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    let pulsado = null;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function () {
        pulsado = { href: this.href, download: this.download };
      },
    );

    downloadBlob(blob, "tracklist.csv");

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(pulsado).toEqual({ href: "blob:x", download: "tracklist.csv" });
    // No al momento: el navegador aún tiene que leerla para guardar el archivo
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
  });
});

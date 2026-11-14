import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { I18nProvider } from "../../src/i18n";
import { useI18n, STORAGE_KEY } from "../../src/i18n/context";

// Los idiomas, salvo el inglés, se cargan al pedirlos: el proveedor tiene que
// enseñar el idioma bueno en cuanto llega, sin quedarse en inglés.
let api;
const Muestra = () => {
  api = useI18n();
  return <span data-testid="texto">{api.t("configTitle")}</span>;
};
const pintar = () =>
  render(
    <I18nProvider>
      <Muestra />
    </I18nProvider>,
  );
const texto = () => screen.getByTestId("texto").textContent;

beforeEach(() => localStorage.clear());

describe("I18nProvider", () => {
  it("con un idioma guardado, lo enseña en cuanto se ha cargado", async () => {
    localStorage.setItem(STORAGE_KEY, "ko");
    pintar();
    expect(api.lang).toBe("ko");
    await screen.findByText("설정: 오디오 출력 및 분석");
  });

  it("al cambiar de idioma lo carga y entonces cambia (y lo recuerda)", async () => {
    pintar();
    expect(texto()).toBe("Settings: audio outputs and analysis");
    await act(() => api.setLang("es"));
    expect(api.lang).toBe("es");
    expect(texto()).toBe("Configuración: salidas de audio y análisis");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("es");
  });

  it("un idioma que no existe no cambia nada", async () => {
    pintar();
    await act(() => api.setLang("xx"));
    expect(api.lang).toBe("en");
  });
});

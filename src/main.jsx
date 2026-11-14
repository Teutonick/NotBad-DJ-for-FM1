import { createRoot } from "react-dom/client";
import "./index.css";
import MiniDJPlayer from "./MiniDJPlayer";
import { I18nProvider } from "./i18n";
import { detectLanguage } from "./i18n/context";
import { loadLocale } from "./i18n/locales";
import { installGlobalErrorHandlers } from "./lib/log";

// Lo que no capture nadie acaba también en el registro
installGlobalErrorHandlers();

// El idioma (salvo el inglés) va en su propio fichero: se trae antes del
// primer pintado para no enseñar la interfaz en inglés un instante. Si falla,
// se pinta igual y el proveedor lo reintenta.
loadLocale(detectLanguage())
  .catch(() => {})
  .finally(() => {
    createRoot(document.getElementById("root")).render(
      <I18nProvider>
        <MiniDJPlayer />
      </I18nProvider>
    );
  });

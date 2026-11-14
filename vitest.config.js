import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.js'

// Dos proyectos con entornos distintos:
//   unit → Node pelado, para la lógica pura (audio, lib, i18n). Arranca en
//          milisegundos porque no monta ningún DOM.
//   dom  → jsdom + Testing Library, solo para los componentes de React.
// Las pruebas de navegador (tests/e2e) viven en vitest.e2e.config.js aparte:
// dependen de tener Chrome en la máquina y no deben tumbar el CI.
//
// Plugins y `define` (__APP_VERSION__) salen de vite.config.js: los tests ven
// el mismo código que la app, sin repetirlos aquí.
export default mergeConfig(viteConfig, defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.{js,jsx}'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['tests/dom/**/*.test.{js,jsx}'],
          setupFiles: ['tests/setup/dom.js'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{js,jsx}'],
      // Sin lógica que probar: punto de entrada, tablas de traducción y el
      // worker (una envoltura de tres líneas sobre detectTempo).
      exclude: ['src/main.jsx', 'src/i18n/locales/**', 'src/**/*.worker.js'],
    },
  },
}))

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from '@testing-library/react'
import MiniDJPlayer from '../../src/MiniDJPlayer'
import { renderWithI18n } from '../helpers/render.jsx'

// Lo que se prueba aquí es el CABLEADO del layout raíz: qué props reciben los
// hijos y cuándo cambian de identidad. Los hijos son dobles que cuentan sus
// renders (envueltos en memo, igual que los de verdad) y guardan sus props.
// vi.hoisted: los vi.mock suben arriba del todo y necesitan esto ya creado
const { renders, props, doble } = vi.hoisted(() => {
  const renders = { CentralMeters: 0, TrackList: 0 }
  const props = {}
  const doble = (nombre) => async () => {
    const { memo } = await import('react')
    return {
      default: memo((p) => {
        renders[nombre] = (renders[nombre] || 0) + 1
        props[nombre] = p
        return null
      }),
    }
  }
  return { renders, props, doble }
})

vi.mock('../../src/components/CentralMeters', doble('CentralMeters'))
vi.mock('../../src/components/TrackList', doble('TrackList'))
vi.mock('../../src/components/Mixer', doble('Mixer'))
vi.mock('../../src/components/ConfigDialog', doble('ConfigDialog'))
vi.mock('../../src/components/HeadphoneCue', () => ({ default: () => null }))
vi.mock('../../src/components/UpdateToast', () => ({ default: () => null }))
// Deck recibe ref (las APIs de los atajos); en React 19 es una prop más
vi.mock('../../src/components/Deck', async () => {
  const { memo } = await import('react')
  return {
    default: memo((p) => {
      props[`Deck${p.side}`] = p
      return null
    }),
  }
})
vi.mock('../../src/audio/engine', () => ({
  AudioEngine: class {
    ctx = {}
    setMaster() {}
    setDeckVolume() {}
    setDeckOutput() {}
    setMasterSink() {
      return Promise.resolve()
    }
    attachMediaElement() {}
  },
}))
vi.mock('../../src/lib/trackStore', async (importOriginal) => ({
  ...(await importOriginal()),
  loadStoredTracks: vi.fn(async () => []),
  storeTrack: vi.fn(async () => {}),
  removeStoredTrack: vi.fn(async () => {}),
}))

beforeEach(() => {
  localStorage.clear()
  // Las <audio> ocultas de salida por deck: jsdom no implementa pause()
  HTMLMediaElement.prototype.pause = () => {}
  for (const k of Object.keys(renders)) renders[k] = 0
})

// Un cambio de estado del raíz que no tiene nada que ver con la cabecera ni
// con la lista: mover el volumen del deck A desde el mixer
const moverVolumen = (v) => act(() => props.Mixer.onVolChange('A', v))

describe('MiniDJPlayer', () => {
  it('mover un fader no vuelve a pintar la cabecera ni la lista (memo)', () => {
    renderWithI18n(<MiniDJPlayer />)
    const cab = renders.CentralMeters
    const lista = renders.TrackList
    moverVolumen(0.5)
    moverVolumen(0.3)
    expect(renders.CentralMeters).toBe(cab)
    expect(renders.TrackList).toBe(lista)
  })

  it('la paleta de la onda solo cambia con los colores, no con cualquier ajuste de ⚙', () => {
    renderWithI18n(<MiniDJPlayer />)
    const paleta = props.DeckA.wavePalette
    act(() => props.ConfigDialog.onConfigChange((c) => ({ ...c, showKey: !c.showKey })))
    expect(props.DeckA.wavePalette).toBe(paleta)
    expect(props.DeckB.wavePalette).toBe(paleta)

    act(() => props.ConfigDialog.onConfigChange((c) => ({ ...c, wavePreset: 'custom', waveCustom: { low: '#ff0000' } })))
    expect(props.DeckA.wavePalette).not.toBe(paleta)
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import Deck from '../../src/components/Deck'
import { renderWithI18n, t } from '../helpers/render.jsx'
import { esperarCargada } from '../helpers/deck.jsx'
import { makeAudioBuffer, sine } from '../helpers/signals'

// Igual que en DeckLoad: la onda va a un canvas y aquí solo estorba, y el
// detector real necesita OfflineAudioContext y un Worker.
vi.mock('../../src/components/WaveformCanvas', () => ({ default: () => null }))
vi.mock('../../src/audio/beatGrid', async (importOriginal) => ({
  ...(await importOriginal()),
  computeOnsetEnvelope: vi.fn(async () => null),
  detectTempoAsync: vi.fn(async () => null),
}))
vi.mock('../../src/audio/metadata', () => ({ readTrackMetadata: vi.fn(async () => ({})) }))

// Buffer largo (30 s) y ligero: la duración de la pista sale del AudioBuffer
// decodificado, y con dos segundos los loops de este test no cabrían.
const SR = 8000
let decodeAudioData
let tiempo // currentTime del <audio>: jsdom no reproduce nada
let velocidad // playbackRate del <audio>

const motor = () => ({ ctx: { decodeAudioData }, resume: vi.fn(async () => {}) })
const pista = () => new File([new Uint8Array(2048)], 'tema.mp3', { type: 'audio/mpeg' })

const deckEl = (file, token, props) => (
  <Deck
    colorClass=""
    engine={motor()}
    side="A"
    pitchPct={0}
    setPitchPct={() => {}}
    pitchRange={8}
    setPitchRange={() => {}}
    keyLock={false}
    setKeyLock={() => {}}
    onAttachEl={() => {}}
    onAutoGainComputed={() => {}}
    onBpmDetected={() => {}}
    onAnalysis={() => {}}
    onSync={() => {}}
    canSync={false}
    syncActive={false}
    syncLabel=""
    onPlayed={() => {}}
    onPlayingChange={() => {}}
    onTrackMeta={() => {}}
    wavePalette={[]}
    externalTrack={{ file, loadToken: token, ...props.track }}
    isActive={false}
    onActivate={() => {}}
    lockLoadWhilePlaying
    {...props}
  />
)

// Monta el deck y espera a que la pista esté cargada
const montar = async (props = {}) => {
  const utils = renderWithI18n(deckEl(pista(), 1, props))
  await esperarCargada(utils.container)
  return utils
}

beforeEach(() => {
  decodeAudioData = vi.fn(async () =>
    makeAudioBuffer([sine({ seconds: 30, amp: 0.5, sampleRate: SR })], SR)
  )
  URL.createObjectURL = vi.fn(() => 'blob:mini-dj/1')
  URL.revokeObjectURL = vi.fn()
  HTMLMediaElement.prototype.load = vi.fn()
  HTMLMediaElement.prototype.play = vi.fn(async () => {})
  HTMLMediaElement.prototype.pause = vi.fn()
  tiempo = 0
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
    configurable: true,
    get: () => tiempo,
    set: (v) => {
      tiempo = v
    },
  })
  velocidad = 1
  // Como en un navegador: el rAF recibe la marca de performance.now(), que es
  // con la que el deck mide sus rampas. El de jsdom usa otro origen de tiempo
  // y la rampa no llegaba nunca al final.
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) =>
    setTimeout(() => cb(performance.now()), 16)
  )
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => clearTimeout(id))
  Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', {
    configurable: true,
    get: () => velocidad,
    set: (v) => {
      velocidad = v
    },
  })
  Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
    configurable: true,
    get: () => 200,
  })
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
    configurable: true,
    get: () => true,
  })
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})


// Pitch y bend: el tempo se aplica como playbackRate del <audio>
// Las rampas son de ~120 ms, pero con la máquina cargada 1 s de espera se
// quedaba corto y el test fallaba a veces: margen amplio.
const ESPERA = { timeout: 3000 }
// usePlaybackRate se salta los retoques inaudibles mientras el tempo se mueve,
// pero al quedarse quieto escribe el valor exacto: se espera ese (T34)
const casi = (esperado) => {
  expect(velocidad).toBeCloseTo(esperado, 9)
}

describe('pitch del deck', () => {
  it('un salto grande (SYNC, reset) llega al tempo pedido con una rampa corta', async () => {
    const utils = await montar({ pitchPct: 0 })
    utils.rerender(deckEl(pista(), 1, { pitchPct: 4 }))
    await waitFor(() => expect(velocidad).toBeCloseTo(1.04, 6), ESPERA)
  })

  it('un retoque pequeño (arrastrar el fader) se aplica de una vez', async () => {
    const utils = await montar({ pitchPct: 0 })
    utils.rerender(deckEl(pista(), 1, { pitchPct: 0.5 }))
    await waitFor(() => expect(velocidad).toBeCloseTo(1.005, 6), ESPERA)
  })
})

describe('bend', () => {
  it('mientras se mantiene pulsado estira el tempo lo que diga la configuración, y al soltar vuelve', async () => {
    await montar({ pitchPct: 2, bendRange: 4 })
    await waitFor(() => casi(1.02), ESPERA)

    const mas = screen.getByTitle(t('bendPlusTitle'))
    fireEvent.mouseDown(mas)
    await waitFor(() => casi(1.06), ESPERA)
    fireEvent.mouseUp(mas)
    await waitFor(() => casi(1.02), ESPERA)

    const menos = screen.getByTitle(t('bendMinusTitle'))
    fireEvent.mouseDown(menos)
    await waitFor(() => casi(0.98), ESPERA)
    fireEvent.mouseLeave(menos)
    await waitFor(() => casi(1.02), ESPERA)
  })

  it('sin bend configurado usa ±2 %', async () => {
    await montar({ pitchPct: 0, bendRange: 0 })
    const mas = screen.getByTitle(t('bendPlusTitle'))
    fireEvent.mouseDown(mas)
    await waitFor(() => casi(1.02), ESPERA)
    fireEvent.mouseUp(mas)
    await waitFor(() => casi(1), ESPERA)
  })
})

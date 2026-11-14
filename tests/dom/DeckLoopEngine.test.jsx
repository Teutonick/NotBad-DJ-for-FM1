import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, waitFor } from '@testing-library/react'
import { audio, esperar, instalarAudioFalso, montarDeck, ponerEn, posicion } from '../helpers/deck.jsx'

// Caracterización del motor del loop y del roll TAL Y COMO FUNCIONAN HOY, para
// poder sacarlos a un hook (useLoopEngine) sin cambiar nada de lo que se oye.
// El <audio> falso avanza con el reloj real y el motor usa temporizadores de
// verdad: los loops son cortos (0,2 s) para que las vueltas quepan en el test.

vi.mock('../../src/components/WaveformCanvas', () => ({ default: () => null }))
vi.mock('../../src/audio/beatGrid', async (importOriginal) => ({
  ...(await importOriginal()),
  computeOnsetEnvelope: vi.fn(async () => null),
  detectTempoAsync: vi.fn(async () => null),
}))
vi.mock('../../src/audio/metadata', () => ({ readTrackMetadata: vi.fn(async () => ({})) }))

let motor
beforeEach(() => {
  ;({ motor } = instalarAudioFalso())
})
afterEach(() => vi.clearAllMocks())

// Rejilla a 120 BPM (beat = 0,5 s) puesta a mano: la usan roll y loops
const conRejilla = { track: { bpm: 120, gridAnchor: 0, gridManual: true } }

const montar = async (extra = {}) => {
  const onCues = vi.fn()
  const r = await montarDeck({ motor, onCues, ...extra })
  return { ...r, onCues, ultimoLoop: () => onCues.mock.calls.at(-1)?.[1].activeLoop }
}

// Marca IN y OUT con la API de los atajos (como las teclas)
const marcarLoop = (api, desde, hasta) => {
  ponerEn(desde)
  act(() => api().loopIn())
  ponerEn(hasta)
  act(() => api().loopOut())
}
const tocar = async (api) => {
  await act(async () => api().playPause())
}

// Espera a que el motor haya dado `n` saltos. Con temporizadores de verdad, un
// tiempo fijo no vale: con la máquina cargada (CI, dos suites a la vez) el
// aviso puede tardar mucho más que la longitud del loop.
const hastaSaltos = (n) =>
  waitFor(() => expect(audio.saltos.length).toBeGreaterThanOrEqual(n), { timeout: 5000 })

// Lo que dice wrapTime: entra en el IN arrastrando lo que se pasó del OUT.
// `antes` es la posición que leyó el motor para decidir (ver helpers/deck).
const MARGEN = 1e-6
const encajaVuelta = ({ antes, despues }, inicio, fin) =>
  antes >= fin - MARGEN &&
  Math.abs(despues - (inicio + (Math.max(0, antes - fin) % (fin - inicio)))) < MARGEN

// Región del loop que sube al padre, comparada sin arrastrar decimales
const esRegion = (loop, inicio, fin) => {
  expect(loop.start).toBeCloseTo(inicio, 6)
  expect(loop.end).toBeCloseTo(fin, 6)
}

describe('motor del loop', () => {
  it('sonando, al pasar del OUT vuelve al IN conservando la fase', async () => {
    const { api } = await montar()
    marcarLoop(api, 10, 10.2)
    ponerEn(10.1)
    audio.saltos = []
    await tocar(api)
    await hastaSaltos(2)

    // Cuánto se pasa del OUT antes de saltar depende de lo cargada que esté
    // la máquina; que cada vuelta conserve la fase, no.
    for (const v of audio.saltos) expect(encajaVuelta(v, 10, 10.2)).toBe(true)
    expect(posicion()).toBeGreaterThanOrEqual(10)
  })

  it('en pausa no salta aunque la pista esté pasada del OUT', async () => {
    const { api } = await montar()
    marcarLoop(api, 10, 10.2)
    ponerEn(10.5)
    audio.saltos = []
    await esperar(200)
    expect(audio.saltos).toEqual([])
  })

  it('con el loop apagado la pista sigue de largo', async () => {
    const { api, ultimoLoop } = await montar()
    marcarLoop(api, 10, 10.2)
    act(() => api().loopToggle())
    // apagado, pero la región se conserva
    expect(ultimoLoop()).toMatchObject({ start: 10, end: 10.2 })
    ponerEn(10.1)
    audio.saltos = []
    await tocar(api)
    await esperar(300)
    expect(audio.saltos).toEqual([])
    expect(posicion()).toBeGreaterThan(10.3)
  })

  it('al volver a encenderlo, vuelve a dar vueltas', async () => {
    const { api } = await montar()
    marcarLoop(api, 10, 10.2)
    act(() => api().loopToggle())
    act(() => api().loopToggle())
    ponerEn(10.1)
    audio.saltos = []
    await tocar(api)
    await hastaSaltos(1)
    for (const v of audio.saltos) expect(encajaVuelta(v, 10, 10.2)).toBe(true)
  })

  it('si la región cambia sonando, manda la nueva (el aviso viejo no salta)', async () => {
    const { api, ultimoLoop } = await montar()
    marcarLoop(api, 10, 10.2)
    ponerEn(10.05)
    await tocar(api)
    // Mover el loop sonando dentro: el playhead se va con él
    ponerEn(10.05)
    audio.saltos = []
    act(() => api().loopMove(1))
    esRegion(ultimoLoop(), 10.2, 10.4)
    const [mover] = audio.saltos
    expect(mover.despues - mover.antes).toBeCloseTo(0.2, 6)
    await hastaSaltos(2)
    for (const v of audio.saltos.slice(1)) expect(encajaVuelta(v, 10.2, 10.4)).toBe(true)
  })

  it('mover el loop con el playhead fuera no lo toca', async () => {
    const { api } = await montar()
    marcarLoop(api, 10, 14)
    act(() => api().loopToggle()) // apagado
    ponerEn(20)
    audio.saltos = []
    act(() => api().loopMove(1))
    expect(audio.saltos).toEqual([])
  })

  it('partir el loop sonando con el playhead fuera del tramo nuevo lo mete dentro', async () => {
    const { api, ultimoLoop } = await montar()
    marcarLoop(api, 10, 14)
    await tocar(api)
    ponerEn(13)
    audio.saltos = []
    act(() => api().loopResize(0.5))
    expect(ultimoLoop()).toMatchObject({ start: 10, end: 12 })
    expect(audio.saltos).toHaveLength(1)
    // wrapTime(13…, 10, 12) = 11… (lo que haya avanzado desde el play)
    expect(encajaVuelta(audio.saltos[0], 10, 12)).toBe(true)
    expect(audio.saltos[0].despues).toBeCloseTo(11, 1)
  })

  it('partir el loop en pausa no mueve el playhead', async () => {
    const { api } = await montar()
    marcarLoop(api, 10, 14)
    ponerEn(13)
    audio.saltos = []
    act(() => api().loopResize(0.5))
    expect(audio.saltos).toEqual([])
  })
})

describe('loop roll', () => {
  it('mientras se mantiene da vueltas en un tramo de N beats desde donde estaba', async () => {
    const { api } = await montar(conRejilla)
    ponerEn(20)
    await tocar(api)
    audio.saltos = []
    const inicio = posicion()
    act(() => api().rollStart(0.25)) // 1/4 de beat = 0,125 s
    await hastaSaltos(2)
    for (const v of audio.saltos) expect(encajaVuelta(v, inicio, inicio + 0.125)).toBe(true)
    act(() => api().rollEnd())
  })

  it('al soltar sigue DONDE ESTARÍA sin el roll, y no vuelve a saltar', async () => {
    const { api, ultimoLoop } = await montar(conRejilla)
    ponerEn(20)
    await tocar(api)
    const t0 = performance.now()
    const p0 = posicion()
    act(() => api().rollStart(0.25))
    await esperar(450)
    act(() => api().rollEnd())
    const sinRoll = p0 + (performance.now() - t0) / 1000
    expect(Math.abs(posicion() - sinRoll)).toBeLessThan(0.01)

    // El aviso que quedaba armado no la devuelve al bucle
    audio.saltos = []
    await esperar(300)
    expect(audio.saltos).toEqual([])
    // Y el roll no se queda como loop de la pista
    expect(ultimoLoop()).toBeUndefined()
  })

  // T38: si el aviso llega tarde más de una vuelta entera (el hilo principal
  // bloqueado, p. ej. por el análisis de tonalidad), el salto retrocede varias
  // longitudes de golpe y la cuenta tiene que sumarlas todas
  it('al soltar sigue donde estaría aunque un aviso llegara varias vueltas tarde', async () => {
    const { api } = await montar(conRejilla)
    ponerEn(20)
    await tocar(api)
    const t0 = performance.now()
    const p0 = posicion()
    act(() => api().rollStart(0.25)) // 0,125 s por vuelta
    await esperar(50)
    const hasta = performance.now() + 400
    while (performance.now() < hasta); // hilo bloqueado: ~3 vueltas sin aviso
    await esperar(100)
    act(() => api().rollEnd())
    const sinRoll = p0 + (performance.now() - t0) / 1000
    expect(Math.abs(posicion() - sinRoll)).toBeLessThan(0.01)
  })

  it('un segundo rollStart con uno en marcha no hace nada', async () => {
    const { api } = await montar(conRejilla)
    ponerEn(20)
    await tocar(api)
    act(() => api().rollStart(0.25))
    const inicio = posicion()
    await esperar(50)
    act(() => api().rollStart(1)) // ignorado: sigue el de 1/4
    await esperar(400)
    const ultimas = audio.saltos.slice(-2)
    for (const v of ultimas) expect(v.despues).toBeLessThan(inicio + 0.125)
    act(() => api().rollEnd())
  })

  it('sin rejilla no hay roll', async () => {
    const { api } = await montar()
    ponerEn(20)
    await tocar(api)
    audio.saltos = []
    act(() => api().rollStart(0.25))
    await esperar(300)
    expect(audio.saltos).toEqual([])
    act(() => api().rollEnd())
    expect(audio.saltos).toEqual([])
  })
})

describe('loops guardados', () => {
  it('recuperarlo salta a su IN y lo enciende; la segunda vez lo apaga', async () => {
    const { api, ultimoLoop } = await montar()
    marcarLoop(api, 10, 10.2)
    act(() => api().loopSave())
    act(() => api().loopToggle()) // apagado
    ponerEn(20)
    audio.saltos = []

    act(() => api().loopSavedToggle())
    expect(audio.saltos).toEqual([expect.objectContaining({ despues: 10 })])
    expect(ultimoLoop()).toMatchObject({ start: 10, end: 10.2 })
    await tocar(api)
    await hastaSaltos(2) // el salto al IN + alguna vuelta
    for (const v of audio.saltos.slice(1)) expect(encajaVuelta(v, 10, 10.2)).toBe(true)

    // Sonando ese mismo loop, la tecla lo apaga (sin mover nada)
    act(() => api().loopSavedToggle())
    const n = audio.saltos.length
    await esperar(300)
    expect(audio.saltos).toHaveLength(n)
  })
})

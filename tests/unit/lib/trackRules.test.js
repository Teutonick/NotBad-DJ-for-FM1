import { describe, it, expect } from 'vitest'
import {
  newTrackFromFile,
  nextPendingAnalysis,
  nextPendingTags,
  sameStructure,
  withCues,
  withDeckMeta,
  withGrid,
  withPlayed,
  withStructure,
  withTags,
} from '../../../src/lib/trackRules'

// Reglas de cómo cambia una pista de la lista con cada dato que llega. Todas
// devuelven LA MISMA pista si no cambia nada: así no se escribe en IndexedDB.

const archivo = (name = 'tema.mp3', size = 4096) => ({ name, size, lastModified: 7 })
const pista = (over = {}) => ({ ...newTrackFromFile(archivo()), ...over })

describe('newTrackFromFile', () => {
  it('fila nueva con todo por analizar', () => {
    const f = archivo('a.mp3', 10)
    expect(newTrackFromFile(f)).toEqual({
      id: 'a.mp3-10-7',
      name: 'a.mp3',
      size: 10,
      file: f,
      bpm: null,
      gridAnchor: null,
      gridManual: false,
      duration: null,
      playedOn: {},
      analyzed: false,
      artist: null,
      title: null,
      album: null,
      artwork: null,
      metaRead: false,
      musicalKey: null,
    })
  })
})

describe('withGrid (rejilla que llega del deck)', () => {
  it('guarda BPM, ancla, si es manual y la duración del <audio>', () => {
    const t = pista()
    expect(withGrid(t, { bpm: 128, anchor: 0.2, manual: true, duration: 200 })).toMatchObject({
      bpm: 128,
      gridAnchor: 0.2,
      gridManual: true,
      duration: 200,
    })
  })

  it('sin cambios (y con duración ya conocida) devuelve la misma pista', () => {
    const t = pista({ bpm: 128, gridAnchor: 0.2, gridManual: true, duration: 200 })
    expect(withGrid(t, { bpm: 128, anchor: 0.2, manual: true, duration: 201 })).toBe(t)
  })

  it('una duración que no vale no pisa la que había', () => {
    const t = pista({ duration: 180 })
    expect(withGrid(t, { bpm: 128, anchor: 0, manual: false, duration: NaN }).duration).toBe(180)
    expect(withGrid(t, { bpm: 128, anchor: 0, manual: false, duration: 0 }).duration).toBe(180)
  })

  it('si falta la duración se escribe aunque la rejilla sea la misma', () => {
    const t = pista({ bpm: 128, gridAnchor: 0, gridManual: false, duration: null })
    expect(withGrid(t, { bpm: 128, anchor: 0, manual: false, duration: 200 })).not.toBe(t)
  })
})

describe('withDeckMeta (lo que lee el deck al cargar)', () => {
  it('la tonalidad solo entra si la pista no tenía', () => {
    const k = { pitchClass: 9, mode: 'minor' }
    expect(withDeckMeta(pista(), { musicalKey: k }).musicalKey).toBe(k)
    const conKey = pista({ musicalKey: { pitchClass: 0, mode: 'major' } })
    expect(withDeckMeta(conKey, { musicalKey: k })).toBe(conKey)
  })

  it('las etiquetas solo entran si aún no se habían leído', () => {
    const tags = { artist: 'Nina', title: 'Aurora', album: 'X', artwork: null }
    expect(withDeckMeta(pista(), tags)).toMatchObject({ ...tags, metaRead: true })
    const leida = pista({ metaRead: true, artist: 'Otra' })
    expect(withDeckMeta(leida, tags)).toBe(leida)
  })
})

describe('withCues (hot cues y loops del usuario)', () => {
  it('guarda lo que llega, saneado', () => {
    const r = withCues(pista(), {
      hotCues: [{ i: 0, t: 12.5, name: 'drop' }],
      savedLoops: [],
      activeLoop: { start: 30, end: 34, beats: 8 },
    })
    expect(r.hotCues).toEqual([{ i: 0, t: 12.5, name: 'drop' }])
    expect(r.activeLoop).toEqual({ start: 30, end: 34, beats: 8 })
  })

  it('activeLoop undefined (durante un roll) conserva el loop guardado', () => {
    const t = pista({ activeLoop: { start: 30, end: 34, beats: 8 }, hotCues: [], savedLoops: [] })
    expect(withCues(t, { hotCues: [], savedLoops: [], activeLoop: undefined })).toBe(t)
  })

  it('sin cambios devuelve la misma pista', () => {
    const t = pista({ hotCues: [{ i: 1, t: 5, name: '' }], savedLoops: [], activeLoop: null })
    expect(withCues(t, { hotCues: [{ i: 1, t: 5, name: '' }], savedLoops: [], activeLoop: null })).toBe(t)
  })
})

describe('withStructure / sameStructure', () => {
  const estructura = (over = {}) => ({
    sections: [
      { start: 0, end: 30, kick: true },
      { start: 30, end: 60, kick: false },
    ],
    phraseSize: 16,
    phraseOffset: 0,
    detectedOffset: 0,
    confident: true,
    manual: false,
    ...over,
  })

  it('compara por los límites de los tramos y los ajustes de frase', () => {
    expect(sameStructure(estructura(), estructura())).toBe(true)
    expect(sameStructure(estructura(), estructura({ phraseOffset: 4 }))).toBe(false)
    expect(sameStructure(estructura(), estructura({ manual: true }))).toBe(false)
    const corrida = estructura()
    corrida.sections[1] = { start: 31, end: 60, kick: false }
    expect(sameStructure(estructura(), corrida)).toBe(false)
    expect(sameStructure(null, null)).toBe(true)
    expect(sameStructure(estructura(), null)).toBe(false)
  })

  it('solo cambia la pista si la estructura es otra', () => {
    const t = pista({ structure: estructura() })
    expect(withStructure(t, estructura())).toBe(t)
    expect(withStructure(t, estructura({ phraseOffset: 4 })).structure.phraseOffset).toBe(4)
  })
})

describe('withPlayed', () => {
  it('marca el deck en el que se pinchó, una sola vez', () => {
    const t = withPlayed(pista(), 'A')
    expect(t.playedOn).toEqual({ A: true })
    expect(withPlayed(t, 'A')).toBe(t)
    expect(withPlayed(t, 'B').playedOn).toEqual({ A: true, B: true })
  })
})

describe('withTags (etiquetas leídas en segundo plano)', () => {
  it('mete las etiquetas y la marca de leída', () => {
    expect(withTags(pista(), { artist: 'Nina', title: null, album: null, artwork: null })).toMatchObject({
      artist: 'Nina',
      metaRead: true,
    })
  })
})

describe('colas de fondo: qué pista toca', () => {
  it('análisis: la primera sin analizar a la que le falta BPM o tonalidad y no falló', () => {
    const lista = [
      pista({ id: 'hecha', analyzed: true }),
      pista({ id: 'fallo', analyzeFailed: true }),
      pista({ id: 'completa', bpm: 128, musicalKey: { pitchClass: 0, mode: 'major' } }),
      pista({ id: 'esta' }),
    ]
    expect(nextPendingAnalysis(lista)?.id).toBe('esta')
    expect(nextPendingAnalysis(lista.slice(0, 3))).toBeUndefined()
  })

  it('etiquetas: la primera sin leer', () => {
    expect(nextPendingTags([pista({ id: 'a', metaRead: true }), pista({ id: 'b' })])?.id).toBe('b')
    expect(nextPendingTags([pista({ metaRead: true })])).toBeUndefined()
  })
})

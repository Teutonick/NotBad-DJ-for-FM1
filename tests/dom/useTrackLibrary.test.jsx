import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useTrackLibrary } from '../../src/hooks/useTrackLibrary'
import { loadStoredTracks, removeStoredTrack, storeTrack } from '../../src/lib/trackStore'
import { quickAnalyzeTrack } from '../../src/audio/analyzeTrack'
import { readTrackMetadata } from '../../src/audio/metadata'

// IndexedDB y los análisis de fondo, de mentira: aquí se prueba QUÉ se guarda
// y cuándo, no la base de datos (eso está en trackStore.test).
vi.mock('../../src/lib/trackStore', async (importOriginal) => ({
  ...(await importOriginal()),
  loadStoredTracks: vi.fn(async () => []),
  storeTrack: vi.fn(async () => {}),
  removeStoredTrack: vi.fn(async () => {}),
}))
vi.mock('../../src/audio/analyzeTrack', () => ({ quickAnalyzeTrack: vi.fn() }))
vi.mock('../../src/audio/metadata', () => ({ readTrackMetadata: vi.fn() }))

const archivo = (name, size = 100) => new File([new Uint8Array(size)], name, { lastModified: 1 })

// Deja correr las promesas pendientes (con temporizadores falsos)
const vaciar = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  loadStoredTracks.mockResolvedValue([])
  readTrackMetadata.mockResolvedValue({ artist: 'Nina', title: 'Aurora', album: null, artwork: null })
  quickAnalyzeTrack.mockResolvedValue({ bpm: 128, gridAnchor: 0.1, duration: 200, musicalKey: null })
  // Sin requestIdleCallback: la cola corre en cuanto pasan los 5 s
  delete window.requestIdleCallback
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useTrackLibrary', () => {
  it('al arrancar trae lo guardado, sin duplicar lo que ya estaba', async () => {
    const guardada = { id: 'g', name: 'g.mp3', size: 1, metaRead: true, analyzed: true }
    loadStoredTracks.mockResolvedValue([guardada])
    const { result } = renderHook(() => useTrackLibrary({ analysisMode: 'deck' }))
    await vaciar()
    expect(result.current.tracks.map((t) => t.id)).toEqual(['g'])
  })

  it('añadir: una fila por archivo nuevo, guardada; el mismo nombre y tamaño no se repite', async () => {
    const { result } = renderHook(() => useTrackLibrary({ analysisMode: 'deck' }))
    await vaciar()
    act(() => result.current.addTracks([archivo('a.mp3'), archivo('b.mp3'), archivo('a.mp3')]))
    expect(result.current.tracks.map((t) => t.name)).toEqual(['a.mp3', 'b.mp3'])
    expect(storeTrack).toHaveBeenCalledTimes(2)
    act(() => result.current.addTracks([archivo('a.mp3')]))
    expect(result.current.tracks).toHaveLength(2)
  })

  it('quitar la borra de la lista y de la base', async () => {
    const { result } = renderHook(() => useTrackLibrary({ analysisMode: 'deck' }))
    await vaciar()
    act(() => result.current.addTracks([archivo('a.mp3')]))
    const id = result.current.tracks[0].id
    act(() => result.current.removeTrack(id))
    expect(result.current.tracks).toEqual([])
    expect(removeStoredTrack).toHaveBeenCalledWith(id)
  })

  it('updateTrack solo escribe en la base si la pista cambia de verdad', async () => {
    const { result } = renderHook(() => useTrackLibrary({ analysisMode: 'deck' }))
    await vaciar()
    act(() => result.current.addTracks([archivo('a.mp3')]))
    const id = result.current.tracks[0].id
    storeTrack.mockClear()

    act(() => result.current.updateTrack(id, (t) => t))
    expect(storeTrack).not.toHaveBeenCalled()

    act(() => result.current.updateTrack(id, (t) => ({ ...t, bpm: 130 })))
    expect(result.current.tracks[0].bpm).toBe(130)
    expect(storeTrack).toHaveBeenCalledTimes(1)
    expect(storeTrack.mock.calls[0][0]).toMatchObject({ id, bpm: 130 })

    // persist:false → solo en memoria
    act(() => result.current.updateTrack(id, (t) => ({ ...t, analyzeFailed: true }), { persist: false }))
    expect(result.current.tracks[0].analyzeFailed).toBe(true)
    expect(storeTrack).toHaveBeenCalledTimes(1)
  })

  it('en modo automático lee etiquetas y analiza en segundo plano, y lo guarda', async () => {
    const { result } = renderHook(() => useTrackLibrary({ analysisMode: 'auto' }))
    await vaciar()
    act(() => result.current.addTracks([archivo('a.mp3')]))
    await vaciar()
    expect(readTrackMetadata).toHaveBeenCalledTimes(1)
    expect(result.current.tracks[0]).toMatchObject({ artist: 'Nina', metaRead: true })

    // El BPM espera 5 s (y a que el navegador esté libre) para no laguear
    expect(quickAnalyzeTrack).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    await vaciar()
    expect(quickAnalyzeTrack).toHaveBeenCalledTimes(1)
    expect(result.current.tracks[0]).toMatchObject({ bpm: 128, duration: 200, analyzed: true })
    expect(storeTrack.mock.calls.at(-1)[0]).toMatchObject({ bpm: 128, analyzed: true })
  })

  it('si el análisis falla se marca solo en memoria (al recargar se reintenta)', async () => {
    quickAnalyzeTrack.mockRejectedValue(new Error('decode'))
    const { result } = renderHook(() => useTrackLibrary({ analysisMode: 'auto' }))
    await vaciar()
    act(() => result.current.addTracks([archivo('a.mp3')]))
    await vaciar()
    storeTrack.mockClear()
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    await vaciar()
    expect(result.current.tracks[0].analyzeFailed).toBe(true)
    expect(storeTrack).not.toHaveBeenCalled()
  })

  it('en modo «solo al cargar en un deck» no analiza nada de fondo', async () => {
    const { result } = renderHook(() => useTrackLibrary({ analysisMode: 'deck' }))
    await vaciar()
    act(() => result.current.addTracks([archivo('a.mp3')]))
    await act(async () => {
      vi.advanceTimersByTime(10000)
    })
    await vaciar()
    expect(readTrackMetadata).not.toHaveBeenCalled()
    expect(quickAnalyzeTrack).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import CentralMeters from '../../src/components/CentralMeters'
import { renderWithI18n, t } from '../helpers/render.jsx'

// Los medidores y el panel de beat-match pintan en canvas: aquí estorban
vi.mock('../../src/components/VUBar', () => ({ default: () => null }))
vi.mock('../../src/components/BeatMatchPanel', () => ({ default: () => null }))

class GrabadorFalso {
  static isTypeSupported = () => true
  start = vi.fn()
  stop = vi.fn()
}

const pintar = () =>
  renderWithI18n(
    <CentralMeters
      engine={{ resume: async () => {}, getRecordStream: () => ({}) }}
      master={1}
      setMaster={() => {}}
      analysis={{ A: null, B: null }}
      audioElsRef={{ current: { A: null, B: null } }}
      masterSyncOn={false}
      onToggleMasterSync={() => {}}
      masterBpm={128}
      setMasterBpm={() => {}}
      onOpenConfig={() => {}}
      vuMode="led"
    />
  )

beforeEach(() => {
  vi.useFakeTimers()
  globalThis.MediaRecorder = GrabadorFalso
})

afterEach(() => {
  vi.useRealTimers()
  delete globalThis.MediaRecorder
})

describe('CentralMeters · REC', () => {
  it('el reloj de la grabación cuenta segundos', async () => {
    pintar()
    fireEvent.click(screen.getByTitle(t('recTitle')))
    // La grabación arranca tras un await (engine.resume): hasta que no existe
    // el intervalo del reloj no hay nada que contar. (El texto «■ 00:00» no
    // sirve para saberlo: va siempre en el botón, oculto, reservando ancho.)
    // act: React pinta el último segundo antes de la aserción, no en una
    // tarea suelta que con la máquina cargada llegaba tarde.
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(screen.getByTitle(t('recTitle')).textContent).toContain('■ 00:03')
  })

  it('si el componente se va mientras graba, su reloj se para', async () => {
    const { unmount } = pintar()
    fireEvent.click(screen.getByTitle(t('recTitle')))
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

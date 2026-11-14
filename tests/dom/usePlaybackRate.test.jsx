import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePlaybackRate } from '../../src/hooks/usePlaybackRate'

// El tempo del deck (pitch + bend) al playbackRate del <audio>. Con relojes
// falsos: los frames (rAF) y los temporizadores avanzan cuando dice el test.
let el
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
  el = { playbackRate: 1 }
})
afterEach(() => vi.useRealTimers())

const montar = (tempoPct) =>
  renderHook(({ pct }) => usePlaybackRate({ current: el }, pct), { initialProps: { pct: tempoPct } })

const frames = (n = 1) => act(() => vi.advanceTimersByTime(16 * n))

describe('usePlaybackRate', () => {
  it('un retoque pequeño se escribe una vez por frame', () => {
    const h = montar(0)
    h.rerender({ pct: 0.5 })
    frames()
    expect(el.playbackRate).toBeCloseTo(1.005, 9)
  })

  it('un salto grande llega al tempo exacto tras la rampa', () => {
    const h = montar(0)
    h.rerender({ pct: 4 })
    frames(20)
    expect(el.playbackRate).toBe(1.04)
  })

  // T34: el último paso de la rampa del bend caía por debajo del umbral de
  // «inaudible» (0,02 %) y se ignoraba: el tempo se quedaba a 1,020194 en
  // vez de 1,02, ~12 ms por minuto de deriva contra el otro deck.
  it('al quedarse quieto acaba en el tempo EXACTO aunque el último cambio fuera inaudible', () => {
    const h = montar(2.019)
    frames(20) // de 1 a 1,02: salto grande, con rampa
    expect(el.playbackRate).toBeCloseTo(1.02019, 9)
    h.rerender({ pct: 2 })
    frames(20)
    expect(el.playbackRate).toBe(1.02)
  })

  it('mientras cambia, los retoques inaudibles no se escriben uno a uno', () => {
    const h = montar(2)
    frames(20)
    let escrituras = 0
    let valor = el.playbackRate
    Object.defineProperty(el, 'playbackRate', {
      get: () => valor,
      set: (v) => {
        escrituras++
        valor = v
      },
    })
    for (let i = 1; i <= 5; i++) {
      h.rerender({ pct: 2 + i * 0.001 })
      frames()
    }
    expect(escrituras).toBe(0)
  })
})

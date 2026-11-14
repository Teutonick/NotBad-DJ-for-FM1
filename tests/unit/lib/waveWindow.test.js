import { describe, it, expect } from 'vitest'
import { computeWaveWindow } from '../../../src/lib/waveWindow'

describe('computeWaveWindow', () => {
  it('con zoom, el playhead va a un tercio de la ventana', () => {
    const w = computeWaveWindow({ total: 1000, zoom: 10, curFrac: 0.5, hasDuration: true })
    expect(w.visible).toBe(100)
    expect(w.windowFrac).toBeCloseTo(0.1)
    expect(w.leftFrac).toBeCloseTo(0.5 - 0.1 / 3)
    expect(w.rightFrac).toBeCloseTo(w.leftFrac + 0.1)
  })

  it('no se sale de la pista ni por el principio ni por el final', () => {
    const inicio = computeWaveWindow({ total: 1000, zoom: 10, curFrac: 0.01, hasDuration: true })
    expect(inicio.leftFrac).toBe(0)
    const fin = computeWaveWindow({ total: 1000, zoom: 10, curFrac: 0.999, hasDuration: true })
    expect(fin.rightFrac).toBeCloseTo(1)
  })

  it('sin duración todavía, la ventana empieza en el principio', () => {
    const w = computeWaveWindow({ total: 1000, zoom: 4, curFrac: 0.7, hasDuration: false })
    expect(w.leftFrac).toBe(0)
    expect(w.rightFrac).toBeCloseTo(0.25)
  })

  it('con zoom 1 cabe la pista entera', () => {
    const w = computeWaveWindow({ total: 1000, zoom: 1, curFrac: 0.4, hasDuration: true })
    expect(w.leftFrac).toBe(0)
    expect(w.rightFrac).toBe(1)
  })
})

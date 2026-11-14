import { describe, it, expect } from 'vitest'
import { canSync, computeSyncPitch, syncTargetBpm } from '../../../src/lib/sync'
import { PITCH_RANGES } from '../../../src/lib/constants'

const estado = (over = {}) => ({
  bpms: { A: 128, B: 125 },
  pitch: { A: 0, B: 0 },
  masterSyncOn: false,
  masterBpm: 130,
  ...over,
})

describe('syncTargetBpm', () => {
  it('sin master sync, el objetivo es el BPM EFECTIVO del otro deck (con su pitch)', () => {
    expect(syncTargetBpm('B', estado())).toBe(128)
    expect(syncTargetBpm('B', estado({ pitch: { A: 2, B: 0 } }))).toBeCloseTo(130.56)
  })

  it('con master sync, el objetivo es el BPM del master', () => {
    expect(syncTargetBpm('A', estado({ masterSyncOn: true }))).toBe(130)
  })

  it('sin BPM del otro deck (o del master) no hay objetivo', () => {
    expect(syncTargetBpm('B', estado({ bpms: { A: null, B: 125 } }))).toBeNull()
    expect(syncTargetBpm('A', estado({ masterSyncOn: true, masterBpm: 0 }))).toBeNull()
  })
})

describe('computeSyncPitch', () => {
  it('el pitch que lleva el deck propio al objetivo, dentro del rango', () => {
    const r = computeSyncPitch({ ownBpm: 125, targetBpm: 128, currentRange: 8, ranges: PITCH_RANGES })
    expect(r.range).toBe(8)
    expect(r.pitch).toBeCloseTo(2.4)
  })

  it('si no cabe, ensancha el rango al siguiente que sirva', () => {
    const r = computeSyncPitch({ ownBpm: 100, targetBpm: 115, currentRange: 8, ranges: PITCH_RANGES })
    expect(r.range).toBe(16)
    expect(r.pitch).toBeCloseTo(15)
  })

  it('si no cabe ni en el mayor, se queda en el tope', () => {
    const r = computeSyncPitch({ ownBpm: 70, targetBpm: 140, currentRange: 8, ranges: PITCH_RANGES })
    expect(r.range).toBe(50)
    expect(r.pitch).toBe(50)
  })

  it('nunca estrecha el rango que ya había', () => {
    const r = computeSyncPitch({ ownBpm: 125, targetBpm: 126, currentRange: 50, ranges: PITCH_RANGES })
    expect(r.range).toBe(50)
  })
})

describe('canSync', () => {
  it('hace falta BPM propio y, sin master, también el del otro deck', () => {
    expect(canSync('A', estado())).toBe(true)
    expect(canSync('A', estado({ bpms: { A: null, B: 125 } }))).toBe(false)
    expect(canSync('A', estado({ bpms: { A: 128, B: null } }))).toBe(false)
    expect(canSync('A', estado({ bpms: { A: 128, B: null }, masterSyncOn: true }))).toBe(true)
  })
})

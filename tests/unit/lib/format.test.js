import { describe, it, expect } from 'vitest'
import { stripExtension } from '../../../src/lib/format'

describe('stripExtension', () => {
  it.each([
    ['tema.mp3', 'tema'],
    ['mi.tema.final.flac', 'mi.tema.final'],
    ['tema', 'tema'],
    ['.mp3', '.mp3'],
    ['', ''],
    [null, ''],
    [undefined, ''],
  ])('%s → %s', (entrada, salida) => {
    expect(stripExtension(entrada)).toBe(salida)
  })
})

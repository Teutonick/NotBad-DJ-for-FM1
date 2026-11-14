import { describe, it, expect } from 'vitest'
import { csvField, csvLine } from '../../../src/lib/csv'

describe('csv', () => {
  it('deja tal cual lo que no necesita comillas', () => {
    expect(csvLine(['Aurora', 'Nina', '05:00', 128])).toBe('Aurora;Nina;05:00;128')
  })

  it('entrecomilla separador, comillas y saltos, y duplica las comillas', () => {
    expect(csvField('Song; Remix')).toBe('"Song; Remix"')
    expect(csvField('DJ "Pepe"')).toBe('"DJ ""Pepe"""')
    expect(csvField('a\nb')).toBe('"a\nb"')
    expect(csvField('a\rb')).toBe('"a\rb"')
  })

  it('null y undefined son campo vacío', () => {
    expect(csvLine([null, undefined, ''])).toBe(';;')
  })

  it('el separador es el que se le pase', () => {
    expect(csvField('a;b', ',')).toBe('a;b')
    expect(csvField('a,b', ',')).toBe('"a,b"')
  })
})

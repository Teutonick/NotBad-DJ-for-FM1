import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import TrackOverview from '../../src/components/TrackOverview'

// El resumen dibuja en un canvas; aquí interesa lo que se puede comprobar sin
// pintar: que no revienta sin datos y que mover el ratón por encima salta a la
// posición correcta de la pista.
const onda = () => Float32Array.from({ length: 400 }, (_, i) => (i % 7) / 7)

const pintar = (props = {}) => {
  const onSeek = vi.fn()
  const utils = render(
    <TrackOverview
      waveData={onda()}
      bandIndex={null}
      beats={[0, 0.5, 1, 1.5]}
      duration={200}
      audioRef={{ current: { currentTime: 50, duration: 200 } }}
      windowRef={{ current: { from: 0.2, to: 0.4 } }}
      onSeek={onSeek}
      title="resumen"
      {...props}
    />
  )
  return { ...utils, onSeek, canvas: screen.getByTitle(props.title || 'resumen') }
}

beforeEach(() => {
  vi.useFakeTimers()
  // El canvas de jsdom no mide: se le da un ancho conocido para poder
  // comprobar la conversión de píxel a posición de la pista
  HTMLCanvasElement.prototype.getBoundingClientRect = () => ({
    left: 100,
    top: 0,
    width: 500,
    height: 28,
    right: 600,
    bottom: 28,
    x: 100,
    y: 0,
  })
})

afterEach(() => {
  vi.useRealTimers()
  delete HTMLCanvasElement.prototype.getBoundingClientRect
})

describe('TrackOverview', () => {
  it('pulsar salta a esa fracción de la pista', () => {
    const { canvas, onSeek } = pintar()
    // 100 px desde la izquierda del lienzo, de 500 de ancho → 20 %
    fireEvent.pointerDown(canvas, { clientX: 200, pointerId: 1 })
    expect(onSeek).toHaveBeenLastCalledWith(0.2)
  })

  it('arrastrar sigue moviendo, y al soltar deja de hacerlo', () => {
    const { canvas, onSeek } = pintar()
    fireEvent.pointerDown(canvas, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 350, pointerId: 1 })
    expect(onSeek).toHaveBeenLastCalledWith(0.5)

    fireEvent.pointerUp(canvas, { pointerId: 1 })
    onSeek.mockClear()
    fireEvent.pointerMove(canvas, { clientX: 500, pointerId: 1 })
    expect(onSeek).not.toHaveBeenCalled()
  })

  it('no se sale de la pista por los bordes', () => {
    const { canvas, onSeek } = pintar()
    fireEvent.pointerDown(canvas, { clientX: -50, pointerId: 1 })
    expect(onSeek).toHaveBeenLastCalledWith(0)
    fireEvent.pointerDown(canvas, { clientX: 9999, pointerId: 1 })
    expect(onSeek).toHaveBeenLastCalledWith(1)
  })

  it('sin pista cargada no revienta', () => {
    expect(() =>
      pintar({ waveData: null, beats: [], duration: 0, audioRef: { current: null } })
    ).not.toThrow()
  })

  it('se refresca solo, sin re-renderizar', () => {
    const { canvas } = pintar()
    const ctx = canvas.getContext('2d')
    const volcados = () => ctx.calls.filter(([n]) => n === 'drawImage').length
    const antes = volcados()
    vi.advanceTimersByTime(500)
    // Cinco vueltas de 100 ms, y cada una vuelca la capa ya pintada
    expect(volcados() - antes).toBeGreaterThanOrEqual(4)
  })

  it('la onda no se repinta en cada refresco: solo se vuelca la capa fija', () => {
    const { canvas } = pintar()
    const ctx = canvas.getContext('2d')
    const barras = () => ctx.calls.filter(([n]) => n === 'fillRect').length
    const antes = barras()
    vi.advanceTimersByTime(1000) // diez vueltas
    // Repintar la onda serían cientos de barras por vuelta (el lienzo mide
    // 500 px). Aquí solo se dibujan las marcas que cambian: cursor, ventana,
    // loop y cues, un puñado por vuelta.
    expect(barras() - antes).toBeLessThan(60)
  })

  it('rehace la capa fija si cambian los tramos, aunque sean los mismos en número', () => {
    // La capa fija acaba con el relieve (un degradado): contar degradados es
    // contar cuántas veces se ha repintado
    let capas = 0
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type) {
      const ctx = original.call(this, type)
      if (ctx && !ctx._contado) {
        const crear = ctx.createLinearGradient
        ctx.createLinearGradient = (...a) => {
          capas += 1
          return crear(...a)
        }
        ctx._contado = true
      }
      return ctx
    }
    try {
      const tramos = (corte) => ({
        confident: true,
        sections: [
          { start: 0, end: corte, kick: false },
          { start: corte, end: 200, kick: true },
        ],
      })
      const props = {
        waveData: onda(),
        bandIndex: null,
        palette: ['#0f0'],
        beats: [0, 0.5, 1, 1.5],
        duration: 200,
        audioRef: { current: { currentTime: 50, duration: 200 } },
        windowRef: { current: { from: 0.2, to: 0.4 } },
        onSeek: () => {},
        title: 'resumen',
      }
      const { rerender } = render(<TrackOverview {...props} structure={tramos(32)} />)
      vi.advanceTimersByTime(300)
      expect(capas).toBe(1)

      // Mismos dos tramos, con el corte en otro sitio (reajuste de frase)
      rerender(<TrackOverview {...props} structure={tramos(64)} />)
      vi.advanceTimersByTime(300)
      expect(capas).toBe(2)
    } finally {
      HTMLCanvasElement.prototype.getContext = original
    }
  })
})

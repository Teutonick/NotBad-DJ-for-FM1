import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { fireEvent, render, screen } from '@testing-library/react'
import NumberField from '../../src/components/NumberField'

const pintar = (props = {}) => {
  const onChange = vi.fn()
  render(
    <NumberField
      value={128}
      min={40}
      max={220}
      step={1}
      onChange={onChange}
      ariaLabel="bpm"
      {...props}
    />
  )
  return { campo: screen.getByLabelText(props.ariaLabel || 'bpm'), onChange }
}

// Arrastre: la pantalla crece hacia abajo, así que subir el ratón es restar Y
const arrastrar = (campo, pixeles, opts = {}) => {
  fireEvent.pointerDown(campo, { clientY: 200, button: 0, pointerId: 1 })
  fireEvent.pointerMove(campo, { clientY: 200 - pixeles, pointerId: 1, ...opts })
  fireEvent.pointerUp(campo, { pointerId: 1 })
}

describe('NumberField', () => {
  it('arrastrar hacia arriba sube y hacia abajo baja', () => {
    const { campo, onChange } = pintar()
    arrastrar(campo, 21) // 21 px / 7 px por paso = 3
    expect(onChange).toHaveBeenLastCalledWith(131)

    onChange.mockClear()
    arrastrar(campo, -21)
    expect(onChange).toHaveBeenLastCalledWith(125)
  })

  it('va despacio: hacen falta varios píxeles por unidad', () => {
    const { campo, onChange } = pintar()
    arrastrar(campo, 3) // menos de un paso: ni se mueve
    expect(onChange).not.toHaveBeenCalled()
  })

  it('con Shift afina todavía más', () => {
    const { campo, onChange } = pintar()
    arrastrar(campo, 28, { shiftKey: true }) // 28 px = 1 paso fino
    expect(onChange).toHaveBeenLastCalledWith(129)
  })

  it('la rueda sube y baja de uno en uno', () => {
    const { campo, onChange } = pintar()
    fireEvent.wheel(campo, { deltaY: -100 })
    expect(onChange).toHaveBeenLastCalledWith(129)
    fireEvent.wheel(campo, { deltaY: 100 })
    expect(onChange).toHaveBeenLastCalledWith(127)
  })

  it('no se sale de los topes', () => {
    const { campo, onChange } = pintar({ value: 219 })
    arrastrar(campo, 70) // pediría 229
    expect(onChange).toHaveBeenLastCalledWith(220)

    const abajo = pintar({ value: 41, ariaLabel: 'bpm2' })
    arrastrar(abajo.campo, -70)
    expect(abajo.onChange).toHaveBeenLastCalledWith(40)
  })

  it('un click sin arrastrar no cambia el número: deja escribir', () => {
    const { campo, onChange } = pintar()
    fireEvent.pointerDown(campo, { clientY: 200, button: 0, pointerId: 1 })
    fireEvent.pointerUp(campo, { pointerId: 1 })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('escribir a mano sigue funcionando', () => {
    const { campo, onChange } = pintar()
    fireEvent.change(campo, { target: { value: '140' } })
    expect(onChange).toHaveBeenLastCalledWith(140)
  })

  it('el botón derecho no arrastra', () => {
    const { campo, onChange } = pintar()
    fireEvent.pointerDown(campo, { clientY: 200, button: 2, pointerId: 1 })
    fireEvent.pointerMove(campo, { clientY: 150, pointerId: 1 })
    expect(onChange).not.toHaveBeenCalled()
  })

  describe('teclear un número entero desde cero', () => {
    // Campo controlado de verdad, como lo usa el master sync
    const Controlado = ({ inicial = 128, onChange }) => {
      const [v, setV] = useState(inicial)
      return (
        <NumberField
          value={v}
          min={40}
          max={220}
          onChange={(n) => {
            setV(n)
            onChange(n)
          }}
          ariaLabel="bpm"
        />
      )
    }

    it('borrar y escribir 125 deja 125', async () => {
      const onChange = vi.fn()
      render(<Controlado onChange={onChange} />)
      const campo = screen.getByLabelText('bpm')
      await userEvent.clear(campo)
      await userEvent.type(campo, '125')
      expect(campo).toHaveValue(125)
      expect(onChange).toHaveBeenLastCalledWith(125)
    })

    it('lo que se sale de los topes se ajusta al soltar el campo, no mientras se escribe', async () => {
      const onChange = vi.fn()
      render(<Controlado onChange={onChange} />)
      const campo = screen.getByLabelText('bpm')
      await userEvent.clear(campo)
      await userEvent.type(campo, '30')
      expect(campo).toHaveValue(30)
      fireEvent.blur(campo)
      expect(campo).toHaveValue(40)
      expect(onChange).toHaveBeenLastCalledWith(40)
    })

    it('Enter también confirma, y un campo vacío vuelve al valor que había', async () => {
      const onChange = vi.fn()
      render(<Controlado onChange={onChange} />)
      const campo = screen.getByLabelText('bpm')
      await userEvent.clear(campo)
      await userEvent.type(campo, '{Enter}')
      expect(campo).toHaveValue(128)
      expect(onChange).not.toHaveBeenCalled()
    })
  })
})

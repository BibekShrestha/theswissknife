import { describe, expect, it } from 'vitest'
import { oneLine } from './Grid'

/**
 * Rows are a fixed height — that is the assumption the windowing arithmetic in
 * virtual.ts is built on. A quoted field with a newline in it would otherwise
 * render two lines inside a one-line box and bleed into the row below.
 */
describe('oneLine', () => {
  it('keeps a multi-line field on one line, showing the break', () => {
    expect(oneLine('Moved off the plan\non the second attempt')).toBe(
      'Moved off the plan ↵ on the second attempt',
    )
  })

  it('handles CRLF the same way', () => {
    expect(oneLine('a\r\nb')).toBe('a ↵ b')
  })

  it('leaves an ordinary value untouched', () => {
    const value = 'Alvarez, Renata'
    expect(oneLine(value)).toBe(value)
  })
})

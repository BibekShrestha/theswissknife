import { describe, expect, it } from 'vitest'
import { quantize } from './quantize'

/** Builds RGBA from a per-pixel colour function. */
function image(
  width: number,
  height: number,
  color: (x: number, y: number) => [number, number, number, number],
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = color(x, y)
      const p = (y * width + x) * 4
      rgba[p] = r
      rgba[p + 1] = g
      rgba[p + 2] = b
      rgba[p + 3] = a
    }
  }
  return rgba
}

function colorAt(result: { indices: Uint8Array; palette: Uint8Array }, i: number) {
  const index = result.indices[i]
  return [
    result.palette[index * 3],
    result.palette[index * 3 + 1],
    result.palette[index * 3 + 2],
  ]
}

/** Mean per-channel error between the source and what the palette can show. */
function meanError(rgba: Uint8Array, result: { indices: Uint8Array; palette: Uint8Array }): number {
  let total = 0
  const pixels = result.indices.length
  for (let i = 0; i < pixels; i++) {
    const [r, g, b] = colorAt(result, i)
    total += Math.abs(rgba[i * 4] - r) + Math.abs(rgba[i * 4 + 1] - g) + Math.abs(rgba[i * 4 + 2] - b)
  }
  return total / (pixels * 3)
}

describe('quantize', () => {
  it('maps a small palette exactly, with no loss at all', () => {
    const rgba = image(8, 8, (x, y) => (x + y) % 2 ? [255, 0, 0, 255] : [0, 0, 255, 255])
    const out = quantize(rgba, 8, 8)

    expect(out.exact).toBe(true)
    expect(out.palette).toHaveLength(2 * 3)
    expect(out.transparentIndex).toBe(-1)
    expect(meanError(rgba, out)).toBe(0)
  })

  it('keeps up to 256 distinct colours exactly', () => {
    const rgba = image(16, 16, (x, y) => [x * 16, y * 16, 0, 255])
    const out = quantize(rgba, 16, 16)

    expect(out.exact).toBe(true)
    expect(out.palette).toHaveLength(256 * 3)
    expect(meanError(rgba, out)).toBe(0)
  })

  it('reduces a true-colour gradient to 256 colours that stay close', () => {
    const rgba = image(64, 64, (x, y) => [x * 4, y * 4, (x * y) % 256, 255])
    const out = quantize(rgba, 64, 64)

    expect(out.exact).toBe(false)
    expect(out.palette.length / 3).toBeLessThanOrEqual(256)
    expect(Math.max(...out.indices)).toBeLessThan(out.palette.length / 3)
    expect(meanError(rgba, out)).toBeLessThan(12)
  })

  it('honours a tighter colour ceiling', () => {
    const rgba = image(32, 32, (x, y) => [x * 8, y * 8, 128, 255])
    const out = quantize(rgba, 32, 32, { maxColors: 8 })

    expect(out.palette.length / 3).toBeLessThanOrEqual(8)
    expect(Math.max(...out.indices)).toBeLessThan(8)
  })

  it('reserves one palette slot for transparency', () => {
    const rgba = image(4, 4, (x) => (x === 0 ? [0, 0, 0, 0] : [10, 20, 30, 255]))
    const out = quantize(rgba, 4, 4)

    expect(out.transparentIndex).toBe(1) // one opaque colour, then the slot
    expect(out.palette).toHaveLength(2 * 3)
    for (let y = 0; y < 4; y++) {
      expect(out.indices[y * 4]).toBe(out.transparentIndex)
      expect(out.indices[y * 4 + 1]).toBe(0)
    }
  })

  it('treats half-transparent pixels as transparent — GIF has no alpha ramp', () => {
    const rgba = image(2, 1, (x) => [255, 255, 255, x === 0 ? 60 : 200])
    const out = quantize(rgba, 2, 1)

    expect(out.indices[0]).toBe(out.transparentIndex)
    expect(out.indices[1]).not.toBe(out.transparentIndex)
  })

  it('stays inside the 256-colour ceiling when transparency is present', () => {
    const rgba = image(64, 64, (x, y) => [x * 4, y * 4, (x + y) % 256, x === 0 ? 0 : 255])
    const out = quantize(rgba, 64, 64)

    expect(out.palette.length / 3).toBeLessThanOrEqual(256)
    expect(out.transparentIndex).toBe(out.palette.length / 3 - 1)
  })

  it('dithering trades banding for noise but keeps every index in range', () => {
    const rgba = image(48, 48, (x, y) => [x * 5, y * 5, 200, 255])
    const plain = quantize(rgba, 48, 48, { maxColors: 8 })
    const dithered = quantize(rgba, 48, 48, { maxColors: 8, dither: true })

    expect(Math.max(...dithered.indices)).toBeLessThan(dithered.palette.length / 3)
    // error diffusion spreads the error rather than repeating it per band
    expect(new Set(dithered.indices).size).toBeGreaterThanOrEqual(new Set(plain.indices).size)
  })

  it('handles a single-pixel image and a single-row image', () => {
    expect(quantize(new Uint8Array([1, 2, 3, 255]), 1, 1).indices).toHaveLength(1)
    const row = image(5, 1, (x) => [x * 50, 0, 0, 255])
    expect(quantize(row, 5, 1, { maxColors: 2, dither: true }).indices).toHaveLength(5)
  })

  it('refuses pixel data that is too short for the stated size', () => {
    expect(() => quantize(new Uint8Array(8), 4, 4)).toThrow(/shorter than/)
  })
})

import { describe, expect, it } from 'vitest'
import { encodeGif, type GifFrame } from './encode'
import { quantize } from './quantize'
import { decodeGif } from './testDecoder'

const CHECKER = new Uint8Array([0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1]) // 4×4
const TWO_COLORS = new Uint8Array([255, 0, 0, 0, 0, 255])

const frame = (over: Partial<GifFrame> = {}): GifFrame => ({
  indices: CHECKER,
  palette: TWO_COLORS,
  ...over,
})

describe('encodeGif', () => {
  it('writes a GIF89a header and a trailer', () => {
    const bytes = encodeGif([frame()], 4, 4)
    expect(String.fromCharCode(...bytes.subarray(0, 6))).toBe('GIF89a')
    expect(bytes[bytes.length - 1]).toBe(0x3b)
    expect(bytes[6] | (bytes[7] << 8)).toBe(4) // width
    expect(bytes[8] | (bytes[9] << 8)).toBe(4) // height
    expect(bytes[10] & 0x80).toBe(0x80) // global colour table present
  })

  it('pads the colour table to a power of two and keeps the real colours', () => {
    const bytes = encodeGif([frame()], 4, 4)
    // two colours → table of two entries → exponent 1
    expect(bytes[10] & 0x07).toBe(0)
    expect([...bytes.subarray(13, 19)]).toEqual([255, 0, 0, 0, 0, 255])
  })

  it('round-trips indices and palette through a decoder', () => {
    const out = decodeGif(encodeGif([frame()], 4, 4))
    expect(out.width).toBe(4)
    expect(out.height).toBe(4)
    expect(out.frames).toHaveLength(1)
    expect(out.frames[0].indices).toEqual(CHECKER)
    expect([...out.frames[0].palette.subarray(0, 6)]).toEqual([255, 0, 0, 0, 0, 255])
    expect(out.loop).toBeNull() // no loop block for a still image
  })

  it('never writes a one-bit code size, which decoders reject', () => {
    const bytes = encodeGif([frame()], 4, 4)
    // image descriptor is 10 bytes, then the minimum code size
    const descriptor = bytes.indexOf(0x2c, 19)
    expect(bytes[descriptor + 10]).toBe(2)
  })

  it('marks a transparent index and reports it back', () => {
    const out = decodeGif(encodeGif([frame({ transparentIndex: 1 })], 4, 4))
    expect(out.frames[0].transparentIndex).toBe(1)
    // pixel 1 uses index 1, so it decodes as fully transparent
    expect(out.frames[0].rgba[4 * 1 + 3]).toBe(0)
    expect(out.frames[0].rgba[3]).toBe(255)
  })

  it('writes a loop block, delays and local palettes for animation', () => {
    const second = frame({
      indices: new Uint8Array(16).fill(1),
      palette: new Uint8Array([0, 255, 0, 9, 9, 9]),
      delayMs: 250,
    })
    const out = decodeGif(encodeGif([frame({ delayMs: 100 }), second], 4, 4, { loop: 3 }))

    expect(out.loop).toBe(3)
    expect(out.frames).toHaveLength(2)
    expect(out.frames[0].delayMs).toBe(100)
    expect(out.frames[1].delayMs).toBe(250)
    // the second frame carried its own colours
    expect([...out.frames[1].palette.subarray(0, 6)]).toEqual([0, 255, 0, 9, 9, 9])
    expect(out.frames[1].indices).toEqual(second.indices)
  })

  it('round-trips a full 256-colour frame', () => {
    const indices = new Uint8Array(256).map((_, i) => i)
    const palette = new Uint8Array(256 * 3).map((_, i) => (i * 7) % 256)
    const out = decodeGif(encodeGif([{ indices, palette }], 16, 16))
    expect(out.frames[0].indices).toEqual(indices)
    expect(out.frames[0].palette).toEqual(palette)
  })

  it('round-trips a quantized photo-like image', () => {
    const width = 40
    const height = 30
    const rgba = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 4
        rgba[p] = (x * 6) % 256
        rgba[p + 1] = (y * 8) % 256
        rgba[p + 2] = (x * y) % 256
        rgba[p + 3] = 255
      }
    }
    const quantized = quantize(rgba, width, height, { dither: true })
    const out = decodeGif(
      encodeGif(
        [
          {
            indices: quantized.indices,
            palette: quantized.palette,
            transparentIndex: quantized.transparentIndex,
          },
        ],
        width,
        height,
      ),
    )

    expect(out.frames[0].indices).toEqual(quantized.indices)
    // and the pixels it shows are close to the original photo
    let error = 0
    for (let i = 0; i < width * height; i++) {
      error += Math.abs(rgba[i * 4] - out.frames[0].rgba[i * 4])
    }
    expect(error / (width * height)).toBeLessThan(12)
  })

  it('rejects frames that do not match the canvas or the palette rules', () => {
    expect(() => encodeGif([], 4, 4)).toThrow(/no frames/)
    expect(() => encodeGif([frame()], 0, 4)).toThrow(/empty canvas/)
    expect(() => encodeGif([frame({ indices: new Uint8Array(15) })], 4, 4)).toThrow(/canvas size/)
    expect(() => encodeGif([frame({ palette: new Uint8Array(0) })], 4, 4)).toThrow(/1–256/)
    expect(() => encodeGif([frame({ palette: new Uint8Array(4) })], 4, 4)).toThrow(/1–256/)
    expect(() => encodeGif([frame({ palette: new Uint8Array(300 * 3) })], 4, 4)).toThrow(/1–256/)
  })
})

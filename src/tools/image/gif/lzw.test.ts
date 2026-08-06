import { describe, expect, it } from 'vitest'
import { ByteWriter, lzwEncode } from './lzw'
import { lzwDecode } from './testDecoder'

/** Deterministic noise — the worst case for LZW, and where code widths grow. */
function noise(length: number, colors: number): Uint8Array {
  const out = new Uint8Array(length)
  let seed = 12345
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    out[i] = (seed >>> 7) % colors
  }
  return out
}

function roundTrip(indices: Uint8Array, minCodeSize: number): Uint8Array {
  return lzwDecode(lzwEncode(indices, minCodeSize), minCodeSize, indices.length)
}

describe('lzwEncode', () => {
  it('round-trips a single pixel', () => {
    expect([...roundTrip(new Uint8Array([3]), 2)]).toEqual([3])
  })

  it('round-trips a long run of one colour', () => {
    const indices = new Uint8Array(5000).fill(7)
    expect(roundTrip(indices, 4)).toEqual(indices)
    // runs are what LZW is for: this must compress hard
    expect(lzwEncode(indices, 4).length).toBeLessThan(200)
  })

  it('round-trips an alternating pattern at the smallest code size', () => {
    const indices = new Uint8Array(1000).map((_, i) => i % 4)
    expect(roundTrip(indices, 2)).toEqual(indices)
  })

  it('round-trips a gradient across a full 256-colour palette', () => {
    const indices = new Uint8Array(4096).map((_, i) => i % 256)
    expect(roundTrip(indices, 8)).toEqual(indices)
  })

  it('round-trips noise long enough to fill and reset the dictionary', () => {
    // > 4096 dictionary entries forces the clear-code path
    const indices = noise(120_000, 256)
    expect(roundTrip(indices, 8)).toEqual(indices)
  })

  it('round-trips noise at every legal minimum code size', () => {
    for (let minCodeSize = 2; minCodeSize <= 8; minCodeSize++) {
      const indices = noise(3000, 1 << minCodeSize)
      expect(roundTrip(indices, minCodeSize), `min code size ${minCodeSize}`).toEqual(indices)
    }
  })

  it('starts the stream with a clear code', () => {
    const bytes = lzwEncode(new Uint8Array([1, 2, 3]), 2)
    expect(bytes[0] & 0b111).toBe(4) // 3-bit code 4 = clear for min code size 2
  })

  it('rejects code sizes GIF does not allow', () => {
    expect(() => lzwEncode(new Uint8Array([0]), 1)).toThrow(/2–8/)
    expect(() => lzwEncode(new Uint8Array([0]), 9)).toThrow(/2–8/)
  })
})

describe('ByteWriter', () => {
  it('grows past its initial capacity', () => {
    const writer = new ByteWriter(2)
    for (let i = 0; i < 100; i++) writer.push(i & 0xff)
    const out = writer.toUint8Array()
    expect(out).toHaveLength(100)
    expect(out[99]).toBe(99)
    expect(writer.size).toBe(100)
  })

  it('writes little-endian 16-bit values and ASCII', () => {
    const writer = new ByteWriter()
    writer.pushU16(0x1234)
    writer.pushAscii('GIF')
    writer.pushBytes([1, 2])
    expect([...writer.toUint8Array()]).toEqual([0x34, 0x12, 71, 73, 70, 1, 2])
  })
})

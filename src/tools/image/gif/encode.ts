/**
 * GIF89a writer. No browser can encode GIF — `canvas.toBlob('image/gif')`
 * silently hands back a PNG — so the bytes are assembled here.
 *
 * Written frame-capable (delays, Netscape loop block, per-frame palettes) even
 * though the tool currently sends one frame: animated input is flattened
 * before it gets here, and keeping the shape means animation support later is
 * a decode-side change, not a rewrite.
 */

import { ByteWriter, lzwEncode } from './lzw'

export interface GifFrame {
  /** One palette index per pixel, width × height of them. */
  indices: Uint8Array
  /** RGB triplets, 1–256 colours. */
  palette: Uint8Array
  /** Palette index shown as transparent, or -1 for none. */
  transparentIndex?: number
  /** Frame duration; GIF stores hundredths of a second. */
  delayMs?: number
}

export interface GifOptions {
  /** 0 loops forever; only written when there is more than one frame. */
  loop?: number
}

export function encodeGif(
  frames: GifFrame[],
  width: number,
  height: number,
  options: GifOptions = {},
): Uint8Array {
  if (frames.length === 0) throw new Error('encodeGif: no frames')
  if (width < 1 || height < 1) throw new Error('encodeGif: empty canvas')

  for (const frame of frames) {
    if (frame.indices.length !== width * height) {
      throw new Error('encodeGif: frame does not match the canvas size')
    }
    const colors = frame.palette.length / 3
    if (colors < 1 || colors > 256 || frame.palette.length % 3 !== 0) {
      throw new Error('encodeGif: palette must hold 1–256 RGB triplets')
    }
  }

  const global = frames[0].palette
  const globalExponent = paletteExponent(global)
  const out = new ByteWriter(width * height + 1024)

  out.pushAscii('GIF89a')
  out.pushU16(width)
  out.pushU16(height)
  out.push(0x80 | (globalExponent - 1)) // global colour table present, its size
  out.push(0) // background colour index
  out.push(0) // pixel aspect ratio: none given
  writePalette(out, global, globalExponent)

  if (frames.length > 1) {
    out.pushBytes([0x21, 0xff, 0x0b])
    out.pushAscii('NETSCAPE2.0')
    out.pushBytes([0x03, 0x01])
    out.pushU16(options.loop ?? 0)
    out.push(0x00)
  }

  for (const frame of frames) {
    const transparent = frame.transparentIndex ?? -1
    const local = samePalette(frame.palette, global) ? null : frame.palette
    const exponent = local ? paletteExponent(local) : globalExponent

    // graphic control extension: transparency, and the delay for animation
    const disposal = frames.length > 1 ? 2 : 0 // restore to background between frames
    out.pushBytes([0x21, 0xf9, 0x04, (disposal << 2) | (transparent >= 0 ? 1 : 0)])
    out.pushU16(Math.max(0, Math.round((frame.delayMs ?? 0) / 10)))
    out.push(transparent >= 0 ? transparent : 0)
    out.push(0x00)

    out.push(0x2c) // image descriptor
    out.pushU16(0)
    out.pushU16(0)
    out.pushU16(width)
    out.pushU16(height)
    out.push(local ? 0x80 | (exponent - 1) : 0x00)
    if (local) writePalette(out, local, exponent)

    // The spec forbids a 1-bit code size; two-colour images use 2.
    const minCodeSize = Math.max(2, exponent)
    out.push(minCodeSize)
    writeSubBlocks(out, lzwEncode(frame.indices, minCodeSize))
  }

  out.push(0x3b) // trailer
  return out.toUint8Array()
}

/** log2 of the padded colour-table size: GIF tables are a power of two. */
function paletteExponent(palette: Uint8Array): number {
  const colors = palette.length / 3
  let exponent = 1
  while (1 << exponent < colors) exponent++
  return Math.min(8, exponent)
}

function writePalette(out: ByteWriter, palette: Uint8Array, exponent: number): void {
  const slots = 1 << exponent
  out.pushBytes(palette)
  const padding = slots * 3 - palette.length
  for (let i = 0; i < padding; i++) out.push(0)
}

/** LZW data travels in chunks of at most 255 bytes, closed by a zero byte. */
function writeSubBlocks(out: ByteWriter, data: Uint8Array): void {
  for (let offset = 0; offset < data.length; offset += 255) {
    const chunk = data.subarray(offset, Math.min(offset + 255, data.length))
    out.push(chunk.length)
    out.pushBytes(chunk)
  }
  out.push(0x00)
}

function samePalette(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

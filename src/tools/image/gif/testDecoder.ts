/**
 * A GIF *decoder*, imported only by the tests in this folder.
 *
 * Node has no image decoder and jsdom has no canvas, so the only way to prove
 * the encoder writes real GIFs is to read them back. Nothing in the app
 * imports this file, so it never reaches a bundle.
 */

export interface DecodedFrame {
  palette: Uint8Array
  transparentIndex: number
  delayMs: number
  indices: Uint8Array
  /** Straight RGBA, so tests can compare against the source pixels. */
  rgba: Uint8Array
}

export interface DecodedGif {
  width: number
  height: number
  /** Loop count from the Netscape extension, or null when absent. */
  loop: number | null
  frames: DecodedFrame[]
}

export function decodeGif(bytes: Uint8Array): DecodedGif {
  const signature = ascii(bytes, 0, 6)
  if (signature !== 'GIF89a' && signature !== 'GIF87a') {
    throw new Error(`not a GIF: ${JSON.stringify(signature)}`)
  }

  const width = u16(bytes, 6)
  const height = u16(bytes, 8)
  const packed = bytes[10]
  let p = 13

  let global = new Uint8Array(0)
  if (packed & 0x80) {
    const colors = 1 << ((packed & 0x07) + 1)
    global = bytes.slice(p, p + colors * 3)
    p += colors * 3
  }

  const frames: DecodedFrame[] = []
  let loop: number | null = null
  let pendingTransparent = -1
  let pendingDelayMs = 0

  while (p < bytes.length) {
    const block = bytes[p]

    if (block === 0x3b) break

    if (block === 0x21) {
      const label = bytes[p + 1]
      if (label === 0xf9) {
        const flags = bytes[p + 3]
        pendingDelayMs = u16(bytes, p + 4) * 10
        pendingTransparent = flags & 0x01 ? bytes[p + 6] : -1
        p += 8
      } else {
        // application extensions carry an 11-byte identifier before their
        // sub-blocks; every other extension starts them right after the label
        const application = label === 0xff ? ascii(bytes, p + 3, 11) : ''
        const { data, next } = readSubBlocks(bytes, label === 0xff ? p + 14 : p + 2)
        if (application === 'NETSCAPE2.0' && data.length >= 3) loop = data[1] | (data[2] << 8)
        p = next
      }
      continue
    }

    if (block === 0x2c) {
      const frameWidth = u16(bytes, p + 5)
      const frameHeight = u16(bytes, p + 7)
      const local = bytes[p + 9]
      p += 10
      let palette = global
      if (local & 0x80) {
        const colors = 1 << ((local & 0x07) + 1)
        palette = bytes.slice(p, p + colors * 3)
        p += colors * 3
      }
      const minCodeSize = bytes[p++]
      const { data, next } = readSubBlocks(bytes, p)
      p = next
      const indices = lzwDecode(data, minCodeSize, frameWidth * frameHeight)
      frames.push({
        palette,
        transparentIndex: pendingTransparent,
        delayMs: pendingDelayMs,
        indices,
        rgba: toRgba(indices, palette, pendingTransparent),
      })
      pendingTransparent = -1
      pendingDelayMs = 0
      continue
    }

    throw new Error(`unexpected block 0x${block.toString(16)} at ${p}`)
  }

  return { width, height, loop, frames }
}

export function lzwDecode(data: Uint8Array, minCodeSize: number, pixels: number): Uint8Array {
  const clearCode = 1 << minCodeSize
  const endCode = clearCode + 1
  const out = new Uint8Array(pixels)
  let written = 0

  let dictionary: number[][] = []
  const reset = (): void => {
    dictionary = []
    for (let i = 0; i < clearCode; i++) dictionary.push([i])
    dictionary.push([]) // clear
    dictionary.push([]) // end
  }
  reset()

  let codeSize = minCodeSize + 1
  let previous: number[] | null = null
  let bitPosition = 0

  const read = (): number | null => {
    let code = 0
    for (let i = 0; i < codeSize; i++) {
      const byte = bitPosition >> 3
      if (byte >= data.length) return null
      code |= ((data[byte] >> (bitPosition & 7)) & 1) << i
      bitPosition++
    }
    return code
  }

  for (;;) {
    const code = read()
    if (code === null || code === endCode) break
    if (code === clearCode) {
      reset()
      codeSize = minCodeSize + 1
      previous = null
      continue
    }

    let entry: number[]
    if (code < dictionary.length) {
      entry = dictionary[code]
    } else if (previous) {
      entry = [...previous, previous[0]]
    } else {
      throw new Error(`bad LZW stream: code ${code} before any prefix`)
    }

    for (const index of entry) {
      if (written < out.length) out[written++] = index
    }

    if (previous) {
      dictionary.push([...previous, entry[0]])
      if (dictionary.length >= 1 << codeSize && codeSize < 12) codeSize++
    }
    previous = entry
  }

  if (written !== pixels) throw new Error(`decoded ${written} pixels, expected ${pixels}`)
  return out
}

function toRgba(indices: Uint8Array, palette: Uint8Array, transparentIndex: number): Uint8Array {
  const rgba = new Uint8Array(indices.length * 4)
  for (let i = 0; i < indices.length; i++) {
    const index = indices[i]
    rgba[i * 4] = palette[index * 3]
    rgba[i * 4 + 1] = palette[index * 3 + 1]
    rgba[i * 4 + 2] = palette[index * 3 + 2]
    rgba[i * 4 + 3] = index === transparentIndex ? 0 : 255
  }
  return rgba
}

function readSubBlocks(bytes: Uint8Array, start: number): { data: Uint8Array; next: number } {
  const chunks: Uint8Array[] = []
  let p = start
  let total = 0
  while (p < bytes.length) {
    const length = bytes[p]
    if (length === 0) {
      p += 1
      break
    }
    chunks.push(bytes.subarray(p + 1, p + 1 + length))
    total += length
    p += length + 1
  }
  const data = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.length
  }
  return { data, next: p }
}

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i])
  return out
}

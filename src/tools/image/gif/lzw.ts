/**
 * GIF-flavoured LZW: variable code width, LSB-first bit packing, dictionary
 * reset at 4096 codes.
 *
 * The code-width bump has to happen at exactly the same code count as the
 * decoder's, or every byte after it decodes as garbage — see lzw.test.ts,
 * which decodes what this produces rather than trusting it.
 */

const MAX_CODES = 4096
const MAX_CODE_SIZE = 12

/** Compressed code stream, without the leading minimum-code-size byte. */
export function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  if (minCodeSize < 2 || minCodeSize > 8) {
    throw new Error(`lzwEncode: minimum code size must be 2–8, got ${minCodeSize}`)
  }

  const clearCode = 1 << minCodeSize
  const endCode = clearCode + 1
  const out = new ByteWriter(Math.max(64, indices.length >> 1))

  let codeSize = minCodeSize + 1
  let nextCode = endCode + 1
  let dictionary = new Map<number, number>()

  let accumulator = 0
  let bits = 0

  const emit = (code: number): void => {
    accumulator |= code << bits
    bits += codeSize
    while (bits >= 8) {
      out.push(accumulator & 0xff)
      accumulator >>>= 8
      bits -= 8
    }
    // The width grows one code AFTER the dictionary outgrows it: a decoder
    // learns each entry one code late, so both sides must switch on the same
    // code or every byte after it decodes as noise.
    if (nextCode > (1 << codeSize) - 1 && codeSize < MAX_CODE_SIZE) codeSize++
  }

  emit(clearCode)

  if (indices.length > 0) {
    let prefix = indices[0]
    for (let i = 1; i < indices.length; i++) {
      const next = indices[i]
      const key = (prefix << 8) | next
      const known = dictionary.get(key)
      if (known !== undefined) {
        prefix = known
        continue
      }
      emit(prefix)
      if (nextCode < MAX_CODES) {
        dictionary.set(key, nextCode++)
      } else {
        // dictionary full: tell the decoder to start over
        emit(clearCode)
        dictionary = new Map()
        codeSize = minCodeSize + 1
        nextCode = endCode + 1
      }
      prefix = next
    }
    emit(prefix)
  }

  emit(endCode)
  if (bits > 0) out.push(accumulator & 0xff)

  return out.toUint8Array()
}

/** Growable byte buffer — the output can be megabytes, so no array of numbers. */
export class ByteWriter {
  private buffer: Uint8Array
  private length = 0

  constructor(capacity = 1024) {
    this.buffer = new Uint8Array(Math.max(16, capacity))
  }

  push(byte: number): void {
    this.ensure(1)
    this.buffer[this.length++] = byte
  }

  pushBytes(bytes: ArrayLike<number>): void {
    this.ensure(bytes.length)
    this.buffer.set(bytes as Uint8Array, this.length)
    this.length += bytes.length
  }

  pushU16(value: number): void {
    this.push(value & 0xff)
    this.push((value >> 8) & 0xff)
  }

  pushAscii(text: string): void {
    for (let i = 0; i < text.length; i++) this.push(text.charCodeAt(i))
  }

  get size(): number {
    return this.length
  }

  toUint8Array(): Uint8Array {
    return this.buffer.slice(0, this.length)
  }

  private ensure(extra: number): void {
    if (this.length + extra <= this.buffer.length) return
    let capacity = this.buffer.length * 2
    while (capacity < this.length + extra) capacity *= 2
    const grown = new Uint8Array(capacity)
    grown.set(this.buffer.subarray(0, this.length))
    this.buffer = grown
  }
}

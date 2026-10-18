/** Small, bounds-checked byte helpers shared by every container parser. */

export class Truncated extends Error {
  constructor(what: string) {
    super(`${what} runs past the end of the file`)
    this.name = 'Truncated'
  }
}

export const u16be = (b: Uint8Array, o: number) => {
  if (o < 0 || o + 2 > b.length) throw new Truncated('A 16-bit field')
  return (b[o] << 8) | b[o + 1]
}
export const u16le = (b: Uint8Array, o: number) => {
  if (o < 0 || o + 2 > b.length) throw new Truncated('A 16-bit field')
  return b[o] | (b[o + 1] << 8)
}
export const u32be = (b: Uint8Array, o: number) => {
  if (o < 0 || o + 4 > b.length) throw new Truncated('A 32-bit field')
  return ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3])
}
export const u32le = (b: Uint8Array, o: number) => {
  if (o < 0 || o + 4 > b.length) throw new Truncated('A 32-bit field')
  return ((b[o + 3] << 24) >>> 0) + ((b[o + 2] << 16) | (b[o + 1] << 8) | b[o])
}
export const u64be = (b: Uint8Array, o: number) => u32be(b, o) * 2 ** 32 + u32be(b, o + 4)

export function putU16be(b: Uint8Array, o: number, v: number) {
  b[o] = (v >>> 8) & 0xff
  b[o + 1] = v & 0xff
}
export function putU32be(b: Uint8Array, o: number, v: number) {
  b[o] = (v >>> 24) & 0xff
  b[o + 1] = (v >>> 16) & 0xff
  b[o + 2] = (v >>> 8) & 0xff
  b[o + 3] = v & 0xff
}
export function putU32le(b: Uint8Array, o: number, v: number) {
  b[o] = v & 0xff
  b[o + 1] = (v >>> 8) & 0xff
  b[o + 2] = (v >>> 16) & 0xff
  b[o + 3] = (v >>> 24) & 0xff
}

/** Bytes as Latin-1 — for four-character codes and ASCII signatures. */
export function ascii(b: Uint8Array, start: number, end: number): string {
  let s = ''
  const stop = Math.min(end, b.length)
  for (let i = Math.max(0, start); i < stop; i++) s += String.fromCharCode(b[i])
  return s
}

/** ASCII up to the first NUL (or `end`). */
export function cString(b: Uint8Array, start: number, end = b.length): string {
  let i = start
  const stop = Math.min(end, b.length)
  while (i < stop && b[i] !== 0) i++
  return ascii(b, start, i)
}

export function startsWith(b: Uint8Array, offset: number, signature: string): boolean {
  if (offset < 0 || offset + signature.length > b.length) return false
  for (let i = 0; i < signature.length; i++) if (b[offset + i] !== signature.charCodeAt(i)) return false
  return true
}

export function indexOf(b: Uint8Array, signature: string, from = 0, to = b.length): number {
  const first = signature.charCodeAt(0)
  const last = Math.min(to, b.length) - signature.length
  for (let i = Math.max(0, from); i <= last; i++) {
    if (b[i] === first && startsWith(b, i, signature)) return i
  }
  return -1
}

export function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  let length = 0
  for (const p of parts) length += p.length
  const out = new Uint8Array(length)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

const utf8 = new TextDecoder('utf-8', { fatal: true })
const latin1 = new TextDecoder('latin1')

/** UTF-8 when it is valid UTF-8, Latin-1 otherwise — metadata writers are sloppy about which. */
export function text(b: Uint8Array): string {
  try {
    return utf8.decode(b)
  } catch {
    return latin1.decode(b)
  }
}

export function utf16(b: Uint8Array, littleEndian: boolean): string {
  let s = ''
  for (let i = 0; i + 1 < b.length; i += 2) {
    const code = littleEndian ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]
    if (code === 0) break
    s += String.fromCharCode(code)
  }
  return s
}

export const hex = (n: number, width = 0) => `0x${n.toString(16).toUpperCase().padStart(width, '0')}`

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

let crcTable: Uint32Array | null = null

/** CRC-32 as PNG uses it (ISO 3309). */
export function crc32(b: Uint8Array, start = 0, end = b.length): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = start; i < end; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Byte ranges [start, end) — what a container keeps as image data, or what it holds as metadata. */
export type Range = readonly [number, number]

export function gather(b: Uint8Array, ranges: readonly Range[]): Uint8Array<ArrayBuffer> {
  return concat(ranges.map(([s, e]) => b.subarray(s, e)))
}

/** The ranges of [0, length) that none of `holes` covers. */
export function complement(length: number, holes: readonly Range[]): Range[] {
  const sorted = [...holes].sort((a, b) => a[0] - b[0])
  const out: Range[] = []
  let at = 0
  for (const [s, e] of sorted) {
    if (s > at) out.push([at, s])
    at = Math.max(at, e)
  }
  if (at < length) out.push([at, length])
  return out
}

/** Inflates zlib data (PNG zTXt/iTXt/iCCP), giving up past `limit` bytes so a deflate bomb cannot eat the tab's memory. */
export async function inflate(data: Uint8Array, limit = 4 * 1024 * 1024): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate'))
  const reader = stream.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    size += value.length
    if (size > limit) {
      await reader.cancel()
      throw new Error(`decompresses to more than ${formatBytes(limit)}`)
    }
  }
  return concat(parts)
}

import { BYTES_PREVIEW, MAX_NODES, TEXT_PREVIEW, type DNode, type Issue } from './types'

/** Raised inside a decoder to stop at `offset`; each decoder catches its own and reports it. */
export class DecodeError extends Error {
  readonly offset: number
  readonly limit: boolean
  constructor(offset: number, message: string, limit = false) {
    super(message)
    this.offset = offset
    this.limit = limit
  }
}

/** Counts decoded items across one decode so no input can produce an unbounded tree. */
export class Budget {
  count = 0
  readonly max: number
  constructor(max = MAX_NODES) {
    this.max = max
  }
  take(offset: number) {
    if (++this.count > this.max) {
      throw new DecodeError(offset, `Stopped after ${this.max.toLocaleString('en-US')} items — the rest is not decoded`, true)
    }
  }
  /** For speculative reads (a protobuf field tried as a message): true when there is room. */
  tryTake(): boolean {
    if (this.count >= this.max) return false
    this.count++
    return true
  }
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

export function hexByte(byte: number): string {
  return HEX[byte & 0xff]
}

/** Hex of `bytes[start..end)` with no separators, cut at `cap` bytes (an ellipsis marks the cut). */
export function hexRange(bytes: Uint8Array, start: number, end: number, cap = BYTES_PREVIEW): string {
  const stop = Math.min(end, start + cap)
  let out = ''
  for (let i = start; i < stop; i++) out += HEX[bytes[i]]
  return stop < end ? `${out}…` : out
}

export function hexOffset(offset: number): string {
  return `0x${offset.toString(16).padStart(offset > 0xffff ? 8 : 4, '0')}`
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

const fatalUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/** Strict UTF-8 (overlongs, surrogates and truncated sequences rejected); null when invalid. */
export function utf8(bytes: Uint8Array): string | null {
  try {
    return fatalUtf8.decode(bytes)
  } catch {
    return null
  }
}

/** Text a person would recognise: no C0/C1 controls except tab and newlines. */
export function isPrintable(text: string): boolean {
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(text)
}

/** A JSON-quoted preview, cut at TEXT_PREVIEW characters. */
export function quote(text: string, cap = TEXT_PREVIEW): string {
  if (text.length <= cap) return JSON.stringify(text)
  return `${JSON.stringify(text.slice(0, cap))}…`
}

/** A float as diagnostic notation writes it: 1.0, 1.0e+300, -0.0, NaN, Infinity. */
export function formatFloat(x: number): string {
  if (Number.isNaN(x)) return 'NaN'
  if (x === Infinity) return 'Infinity'
  if (x === -Infinity) return '-Infinity'
  if (Object.is(x, -0)) return '-0.0'
  const text = String(x)
  if (/[.]/.test(text)) return text
  const e = text.indexOf('e')
  return e < 0 ? `${text}.0` : `${text.slice(0, e)}.0${text.slice(e)}`
}

/** The shortest decimal that reads back as the same float32 (1.1, not 1.100000023841858). */
export function formatFloat32(x: number): string {
  if (!Number.isFinite(x) || x === 0) return formatFloat(x)
  for (let p = 1; p <= 9; p++) {
    const candidate = Number(x.toPrecision(p))
    if (Math.fround(candidate) === x) return formatFloat(candidate)
  }
  return formatFloat(x)
}

export function halfToNumber(h: number): number {
  const sign = h & 0x8000 ? -1 : 1
  const exponent = (h >> 10) & 0x1f
  const fraction = h & 0x3ff
  if (exponent === 0) return sign * fraction * 2 ** -24
  if (exponent === 31) return fraction ? NaN : sign * Infinity
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15)
}

/** True when a float16 holds `x` exactly (NaN and the infinities included). */
export function fitsHalf(x: number): boolean {
  if (!Number.isFinite(x) || x === 0) return true
  const a = Math.abs(x)
  if (a > 65504 || a < 2 ** -24) return false
  let e = Math.floor(Math.log2(a))
  if (2 ** e > a) e--
  if (2 ** (e + 1) <= a) e++
  const step = e < -14 ? 2 ** -24 : 2 ** (e - 10)
  return Number.isInteger(a / step)
}

export function fitsSingle(x: number): boolean {
  return Number.isNaN(x) || Math.fround(x) === x
}

/** Seconds (possibly fractional) since the epoch as an ISO 8601 UTC string, or null outside Date's range. */
export function epochToIso(seconds: number, nanos = 0): string | null {
  if (!Number.isFinite(seconds)) return null
  const ms = Math.floor(seconds) * 1000
  if (Math.abs(ms) > 8.64e15) return null
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return null
  const base = date.toISOString().slice(0, 19)
  let frac = nanos
  if (!nanos && !Number.isInteger(seconds)) frac = Math.round((seconds - Math.floor(seconds)) * 1e9)
  if (!frac) return `${base}Z`
  return `${base}.${String(frac).padStart(9, '0').replace(/0+$/, '')}Z`
}

/** Unsigned big-endian bytes to a bigint; null past `capBytes` (decimal conversion is quadratic). */
export function bytesToBigint(bytes: Uint8Array, capBytes = 4096): bigint | null {
  if (bytes.length > capBytes) return null
  if (!bytes.length) return 0n
  return BigInt(`0x${hexRange(bytes, 0, bytes.length, bytes.length)}`)
}

/** Sets `end` on every node still open (end < 0) when a decoder stopped early, and notes it. */
export function closeOpen(nodes: DNode[], offset: number): void {
  const stack = [...nodes]
  while (stack.length) {
    const node = stack.pop()!
    if (node.end < 0) {
      node.end = Math.max(offset, node.head)
      ;(node.notes ??= []).push({ level: 'warn', text: 'Incomplete — decoding stopped inside this item' })
    }
    // A loop, not push(...children): spreading 100,000 arguments overflows a worker's stack.
    if (node.children) for (const child of node.children) stack.push(child)
    if (node.key) stack.push(node.key)
  }
}

/** Byte-wise comparison of two ranges, as CBOR's deterministic key order uses. */
export function compareRanges(bytes: Uint8Array, a: [number, number], b: [number, number]): number {
  const la = a[1] - a[0]
  const lb = b[1] - b[0]
  const n = Math.min(la, lb)
  for (let i = 0; i < n; i++) {
    const d = bytes[a[0] + i] - bytes[b[0] + i]
    if (d) return d
  }
  return la - lb
}

export function errorOf(error: unknown): Issue | null {
  return error instanceof DecodeError ? { offset: error.offset, message: error.message } : null
}

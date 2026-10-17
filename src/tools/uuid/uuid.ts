import { bytesToBigInt, cryptoRng, encodeUlid, parseUlid, ulidTime, type Rng } from './ulid'

/**
 * UUID parsing, inspection and generation per RFC 9562. Everything works on
 * 16-byte arrays; timestamps that need more than 53 bits stay in bigint.
 */

export type Variant = 'NCS' | 'RFC 9562' | 'Microsoft' | 'Future'

export interface FormatOptions {
  upper?: boolean
  hyphens?: boolean
}

/** 100-ns intervals between 1582-10-15T00:00:00Z (Gregorian reform) and the Unix epoch. */
export const GREGORIAN_OFFSET = 122_192_928_000_000_000n

export const VERSION_NAMES: Record<number, string> = {
  1: 'Gregorian time-based',
  2: 'DCE Security',
  3: 'name-based (MD5)',
  4: 'random',
  5: 'name-based (SHA-1)',
  6: 'reordered Gregorian time-based',
  7: 'Unix Epoch time-based',
  8: 'custom',
}

export type UuidParse = { bytes: Uint8Array; error: null } | { bytes: null; error: string }

const HEX = /^[0-9a-f]+$/i

/**
 * Accepts canonical 8-4-4-4-12, 32 hex digits without hyphens, `{…}` braces
 * and a `urn:uuid:` prefix, in any case.
 */
export function parseUuid(input: string): UuidParse {
  let text = input.trim()
  if (/^urn:uuid:/i.test(text)) text = text.slice(9)
  else if (text.startsWith('{') || text.endsWith('}')) {
    if (!(text.startsWith('{') && text.endsWith('}'))) return { bytes: null, error: 'Unbalanced braces.' }
    text = text.slice(1, -1)
  }
  let hex: string
  if (text.length === 36) {
    for (const at of [8, 13, 18, 23]) {
      if (text[at] !== '-') return { bytes: null, error: `Expected '-' at position ${at + 1} (8-4-4-4-12 groups).` }
    }
    hex = text.replaceAll('-', '')
  } else if (text.length === 32) {
    hex = text
  } else {
    return { bytes: null, error: `A UUID is 32 hex digits (36 with hyphens); got ${text.length} characters.` }
  }
  if (!HEX.test(hex)) {
    const bad = [...hex].find((char) => !/[0-9a-f]/i.test(char))
    return { bytes: null, error: `'${bad}' is not a hex digit.` }
  }
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return { bytes, error: null }
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function formatUuid(bytes: Uint8Array, { upper = false, hyphens = true }: FormatOptions = {}): string {
  const hex = toHex(bytes)
  const text = hyphens
    ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    : hex
  return upper ? text.toUpperCase() : text
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** Unpadded base64url (RFC 4648 §5): 16 bytes become 22 characters. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    const chars = bytes.length - i >= 3 ? 4 : bytes.length - i + 1
    for (let c = 0; c < chars; c++) out += B64URL[(n >> (18 - c * 6)) & 63]
  }
  return out
}

export function variantOf(bytes: Uint8Array): Variant {
  const octet = bytes[8]
  if ((octet & 0x80) === 0) return 'NCS'
  if ((octet & 0xc0) === 0x80) return 'RFC 9562'
  if ((octet & 0xe0) === 0xc0) return 'Microsoft'
  return 'Future'
}

export function versionOf(bytes: Uint8Array): number {
  return bytes[6] >> 4
}

export const isNil = (bytes: Uint8Array) => bytes.every((byte) => byte === 0)
export const isMax = (bytes: Uint8Array) => bytes.every((byte) => byte === 0xff)

/** v1: time_low (32) | time_mid (16) | ver | time_high (12). */
export function v1Timestamp(bytes: Uint8Array): bigint {
  const low = bytesToBigInt(bytes.subarray(0, 4))
  const mid = bytesToBigInt(bytes.subarray(4, 6))
  const high = bytesToBigInt(bytes.subarray(6, 8)) & 0x0fffn
  return (high << 48n) | (mid << 32n) | low
}

/** v6: time_high (32) | time_mid (16) | ver | time_low (12) — v1's field order reversed so it sorts. */
export function v6Timestamp(bytes: Uint8Array): bigint {
  const high = bytesToBigInt(bytes.subarray(0, 4))
  const mid = bytesToBigInt(bytes.subarray(4, 6))
  const low = bytesToBigInt(bytes.subarray(6, 8)) & 0x0fffn
  return (high << 28n) | (mid << 12n) | low
}

/** v7 and ULID share the layout: a 48-bit Unix millisecond timestamp up front. */
export const v7Timestamp = ulidTime

/** ISO 8601 with all seven fractional digits a 100-ns Gregorian timestamp carries. */
export function gregorianIso(ticks: bigint): string {
  const sinceUnix = ticks - GREGORIAN_OFFSET
  let ms = sinceUnix / 10_000n
  let rest = sinceUnix % 10_000n
  if (rest < 0n) { rest += 10_000n; ms -= 1n }
  const iso = new Date(Number(ms)).toISOString()
  return `${iso.slice(0, -1)}${rest.toString().padStart(4, '0')}Z`
}

export const unixMsIso = (ms: number) => new Date(ms).toISOString()

export function clockSequence(bytes: Uint8Array): number {
  return ((bytes[8] & 0x3f) << 8) | bytes[9]
}

export interface NodeInfo {
  hex: string
  /** The multicast bit (LSB of the first octet) marks a random node rather than an IEEE 802 MAC. */
  random: boolean
}

export function nodeOf(bytes: Uint8Array): NodeInfo {
  const node = bytes.subarray(10, 16)
  return {
    hex: Array.from(node, (byte) => byte.toString(16).padStart(2, '0')).join(':'),
    random: (node[0] & 0x01) === 1,
  }
}

export interface Field {
  label: string
  value: string
  note?: string
}

export interface Inspection {
  input: string
  line: number
  kind: 'UUID' | 'ULID'
  summary: string
  bytes: Uint8Array
  fields: Field[]
  forms: Field[]
}

export type LineResult = Inspection | { input: string; line: number; error: string }

/** Inspects one ID. 26 characters means ULID; everything else is tried as a UUID. */
export function inspectId(raw: string, line = 1): LineResult {
  const input = raw.trim()
  const asUlid = input.length === 26
  const parsed = asUlid ? parseUlid(input) : parseUuid(input)
  if (!parsed.bytes) return { input, line, error: parsed.error }
  const bytes = parsed.bytes
  const fields: Field[] = []
  let summary: string

  if (asUlid) {
    const ms = ulidTime(bytes)
    summary = 'ULID'
    fields.push({ label: 'Timestamp', value: unixMsIso(ms), note: `${ms} ms since the Unix epoch` })
    fields.push({ label: 'Randomness', value: toHex(bytes.subarray(6)), note: '80 bits' })
  } else if (isNil(bytes)) {
    summary = 'Nil UUID'
    fields.push({ label: 'Special', value: 'Nil UUID', note: 'all 128 bits zero (RFC 9562 §5.9)' })
  } else if (isMax(bytes)) {
    summary = 'Max UUID'
    fields.push({ label: 'Special', value: 'Max UUID', note: 'all 128 bits one (RFC 9562 §5.10)' })
  } else {
    const variant = variantOf(bytes)
    fields.push({ label: 'Variant', value: variant, note: variantNote(variant) })
    if (variant !== 'RFC 9562') {
      summary = `UUID · ${variant} variant`
    } else {
      const version = versionOf(bytes)
      const name = VERSION_NAMES[version]
      summary = name ? `UUID v${version} · ${name}` : `UUID · unknown version ${version}`
      fields.push({ label: 'Version', value: String(version), note: name ?? 'not defined by RFC 9562' })
      if (version === 1 || version === 6) {
        const ticks = version === 1 ? v1Timestamp(bytes) : v6Timestamp(bytes)
        fields.push({ label: 'Timestamp', value: gregorianIso(ticks), note: `${ticks} × 100 ns since 1582-10-15` })
        fields.push({ label: 'Clock sequence', value: String(clockSequence(bytes)), note: `0x${clockSequence(bytes).toString(16).padStart(4, '0')}` })
        const node = nodeOf(bytes)
        fields.push({
          label: 'Node',
          value: node.hex,
          note: node.random ? 'multicast bit set — random node, not a MAC address' : 'multicast bit clear — IEEE 802 MAC address',
        })
      } else if (version === 7) {
        const ms = v7Timestamp(bytes)
        fields.push({ label: 'Timestamp', value: unixMsIso(ms), note: `${ms} ms since the Unix epoch` })
      }
    }
  }

  return {
    input,
    line,
    kind: asUlid ? 'ULID' : 'UUID',
    summary,
    bytes,
    fields,
    forms: conversions(bytes),
  }
}

function variantNote(variant: Variant): string {
  switch (variant) {
    case 'NCS': return 'reserved, NCS backward compatibility (0xxx)'
    case 'RFC 9562': return 'the variant RFC 9562 defines (10xx)'
    case 'Microsoft': return 'reserved, Microsoft backward compatibility (110x)'
    case 'Future': return 'reserved for future definition (111x)'
  }
}

/** Every form the same 128 bits can be written in. */
export function conversions(bytes: Uint8Array): Field[] {
  return [
    { label: 'UUID', value: formatUuid(bytes) },
    { label: 'ULID', value: encodeUlid(bytes) },
    { label: 'Hex', value: toHex(bytes) },
    { label: 'URN', value: `urn:uuid:${formatUuid(bytes)}` },
    { label: 'Base64url', value: toBase64Url(bytes) },
    { label: 'Bytes', value: Array.from(bytes, (byte) => `0x${byte.toString(16).padStart(2, '0')}`).join(', ') },
  ]
}

export function inspectLines(text: string): LineResult[] {
  return text.split(/\r?\n/).flatMap((line, index) => (line.trim() ? [inspectId(line, index + 1)] : []))
}

function stamp(bytes: Uint8Array, version: number): Uint8Array {
  bytes[6] = (bytes[6] & 0x0f) | (version << 4)
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return bytes
}

/** v4: 122 random bits from crypto.getRandomValues. */
export function uuidV4(rng: Rng = cryptoRng): Uint8Array {
  const bytes = new Uint8Array(16)
  rng(bytes)
  return stamp(bytes, 4)
}

/**
 * v7 factory (RFC 9562 §5.7) with monotonic random (§6.2 method 2): the 74
 * bits of rand_a and rand_b act as one counter. A new millisecond seeds it
 * from getRandomValues; within the same millisecond (or if the clock steps
 * back) it is incremented by one. On counter overflow the timestamp moves
 * to the next millisecond, which §6.2 permits.
 */
export function createV7Generator(rng: Rng = cryptoRng, now: () => number = Date.now) {
  let lastTime = -1
  let counter = 0n
  const COUNTER_MAX = (1n << 74n) - 1n
  const seed = () => {
    const random = new Uint8Array(10)
    rng(random)
    return bytesToBigInt(random) & COUNTER_MAX
  }
  return function nextV7(): Uint8Array {
    let time = now()
    if (!Number.isInteger(time) || time < 0 || time >= 2 ** 48) throw new RangeError('Clock is outside the 48-bit v7 range.')
    if (time <= lastTime) {
      time = lastTime
      if (counter === COUNTER_MAX) { time += 1; counter = seed() } else counter += 1n
    } else {
      counter = seed()
    }
    lastTime = time
    const randA = counter >> 62n
    const randB = counter & ((1n << 62n) - 1n)
    const bytes = new Uint8Array(16)
    let t = time
    for (let i = 5; i >= 0; i--) { bytes[i] = t % 256; t = Math.floor(t / 256) }
    bytes[6] = 0x70 | Number(randA >> 8n)
    bytes[7] = Number(randA & 0xffn)
    let b = randB
    for (let i = 15; i >= 8; i--) { bytes[i] = Number(b & 0xffn); b >>= 8n }
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    return bytes
  }
}

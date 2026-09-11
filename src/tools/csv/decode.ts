/**
 * Bytes to text — the first place a CSV viewer can quietly lie.
 *
 * Spreadsheets on Windows still save Windows-1252 and UTF-16 far more often
 * than UTF-8, and decoding either of those as UTF-8 turns a name with an
 * accent into mojibake, or into U+FFFD, which is unrecoverable. So the guess
 * is made deliberately and reported in the UI: a wrong guess should be visible
 * and fixable, not silent.
 */

export type Encoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252'

export interface Decoded {
  text: string
  encoding: Encoding
  /** True when a byte-order mark decided it, rather than a guess. */
  fromBom: boolean
}

const BOMS: [Encoding, number[]][] = [
  ['utf-8', [0xef, 0xbb, 0xbf]],
  ['utf-16le', [0xff, 0xfe]],
  ['utf-16be', [0xfe, 0xff]],
]

/**
 * Windows-1252 only differs from Latin-1 in 0x80-0x9F; these are the code
 * points that range maps to. Kept as numbers because five of the slots are
 * unassigned and round-trip to bare control codes.
 */
const CP1252_HIGH = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
]

const SNIFF_BYTES = 4096

/**
 * Picks an encoding without decoding. UTF-8 is only a *candidate* here — it is
 * confirmed by a successful strict decode, which the caller does, falling back
 * to Windows-1252 when that throws.
 */
export function sniffEncoding(bytes: Uint8Array): { encoding: Encoding; fromBom: boolean } {
  for (const [encoding, bom] of BOMS) {
    if (bytes.length >= bom.length && bom.every((byte, i) => bytes[i] === byte)) {
      return { encoding, fromBom: true }
    }
  }

  // UTF-16 without a BOM: mostly-ASCII text leaves a NUL in every other byte,
  // and the half it lands in names the endianness.
  const sample = bytes.subarray(0, SNIFF_BYTES)
  let evenNul = 0
  let oddNul = 0
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) i % 2 === 0 ? evenNul++ : oddNul++
  }
  const pairs = sample.length / 2
  if (pairs >= 8) {
    if (evenNul === 0 && oddNul > pairs * 0.6) return { encoding: 'utf-16le', fromBom: false }
    if (oddNul === 0 && evenNul > pairs * 0.6) return { encoding: 'utf-16be', fromBom: false }
  }

  return { encoding: 'utf-8', fromBom: false }
}

/** Chunked, so a large file cannot blow the argument limit of fromCharCode. */
export function decodeWindows1252(bytes: Uint8Array): string {
  const chunk = 0x8000
  const out: string[] = []
  const codes = new Uint16Array(Math.min(chunk, bytes.length))
  for (let start = 0; start < bytes.length; start += chunk) {
    const end = Math.min(start + chunk, bytes.length)
    for (let i = start; i < end; i++) {
      const byte = bytes[i]
      codes[i - start] = byte >= 0x80 && byte <= 0x9f ? CP1252_HIGH[byte - 0x80] : byte
    }
    out.push(String.fromCharCode(...codes.subarray(0, end - start)))
  }
  return out.join('')
}

/** TextDecoder strips a leading BOM for the matching encoding by default. */
const decodeWith = (label: string, bytes: Uint8Array, fatal: boolean) =>
  new TextDecoder(label, { fatal }).decode(bytes)

export function decodeBytes(bytes: Uint8Array): Decoded {
  const { encoding, fromBom } = sniffEncoding(bytes)

  if (encoding === 'utf-16le' || encoding === 'utf-16be') {
    try {
      return { text: decodeWith(encoding, bytes, false), encoding, fromBom }
    } catch {
      // utf-16be is the one label a trimmed-ICU runtime may not carry.
      return { text: decodeWindows1252(bytes), encoding: 'windows-1252', fromBom: false }
    }
  }

  // One pass, not two: a strict decode that survives *is* the UTF-8 result,
  // and one that throws has already proved the file is not UTF-8.
  try {
    return { text: decodeWith('utf-8', bytes, true), encoding: 'utf-8', fromBom }
  } catch {
    try {
      return { text: decodeWith('windows-1252', bytes, false), encoding: 'windows-1252', fromBom: false }
    } catch {
      return { text: decodeWindows1252(bytes), encoding: 'windows-1252', fromBom: false }
    }
  }
}

export const ENCODING_LABELS: Record<Encoding, string> = {
  'utf-8': 'UTF-8',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
  'windows-1252': 'Windows-1252',
}

/**
 * Turns pasted text into bytes: hex (spaces, commas, colons, `0x` and `\x`
 * prefixes tolerated) or Base64 / Base64URL (padding optional, whitespace
 * ignored). Auto picks hex whenever the text is nothing but hex digits and
 * separators, since almost any short hex string is also valid Base64.
 */

export type Encoding = 'auto' | 'hex' | 'base64'

export interface ParsedInput {
  bytes: Uint8Array | null
  /** What the text was read as. */
  encoding: 'hex' | 'base64' | 'base64url' | null
  error: string | null
  /** A second reading worth mentioning ("also valid Base64"). */
  note: string | null
}

const HEX_SEPARATORS = /0x|\\x|[\s,:;]/gi

export function parseHex(text: string): { bytes: Uint8Array } | { error: string } {
  const digits = text.replace(HEX_SEPARATORS, '')
  const bad = /[^0-9a-f]/i.exec(digits)
  if (bad) return { error: `Not hex: unexpected “${bad[0]}”` }
  if (digits.length % 2) return { error: `Odd number of hex digits (${digits.length}) — a byte needs two` }
  const bytes = new Uint8Array(digits.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(digits.substr(i * 2, 2), 16)
  return { bytes }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_INDEX = new Int16Array(128).fill(-1)
for (let i = 0; i < 64; i++) B64_INDEX[B64.charCodeAt(i)] = i
B64_INDEX['-'.charCodeAt(0)] = 62
B64_INDEX['_'.charCodeAt(0)] = 63

export function parseBase64(text: string): { bytes: Uint8Array; url: boolean } | { error: string } {
  const compact = text.replace(/\s+/g, '')
  const body = compact.replace(/=+$/, '')
  const std = /[+/]/.test(body)
  const url = /[-_]/.test(body)
  if (std && url) return { error: 'Not Base64: it mixes the standard (+ /) and URL-safe (- _) alphabets' }
  for (let i = 0; i < body.length; i++) {
    const code = body.charCodeAt(i)
    if (code >= 128 || B64_INDEX[code] < 0) return { error: `Not Base64: unexpected “${body[i]}” at character ${i + 1}` }
  }
  if (body.length % 4 === 1) return { error: 'Not Base64: the length leaves a stray character' }
  const padding = compact.length - body.length
  if (padding && (padding > 2 || compact.length % 4)) return { error: 'Not Base64: wrong amount of = padding' }
  const bytes = new Uint8Array(Math.floor((body.length * 3) / 4))
  let bits = 0
  let acc = 0
  let o = 0
  for (let i = 0; i < body.length; i++) {
    acc = ((acc << 6) | B64_INDEX[body.charCodeAt(i)]) & 0xffffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[o++] = (acc >> bits) & 0xff
    }
  }
  return { bytes, url }
}

export function parseInput(text: string, encoding: Encoding): ParsedInput {
  const empty: ParsedInput = { bytes: new Uint8Array(0), encoding: null, error: null, note: null }
  if (!text.trim()) return empty
  if (encoding === 'hex') {
    const r = parseHex(text)
    return 'error' in r ? { ...empty, bytes: null, error: r.error } : { ...empty, bytes: r.bytes, encoding: 'hex' }
  }
  if (encoding === 'base64') {
    const r = parseBase64(text)
    return 'error' in r ? { ...empty, bytes: null, error: r.error } : { ...empty, bytes: r.bytes, encoding: r.url ? 'base64url' : 'base64' }
  }
  const hex = parseHex(text)
  if (!('error' in hex)) {
    const b64 = /^[0-9a-f\s]+$/i.test(text) ? parseBase64(text) : null
    return {
      ...empty,
      bytes: hex.bytes,
      encoding: 'hex',
      note: b64 && !('error' in b64) ? 'Also valid Base64 — choose Base64 to read it that way' : null,
    }
  }
  const b64 = parseBase64(text)
  if (!('error' in b64)) return { ...empty, bytes: b64.bytes, encoding: b64.url ? 'base64url' : 'base64' }
  return { ...empty, bytes: null, error: `Neither hex nor Base64. As hex: ${hex.error.replace(/^Not hex: /, '')}; as Base64: ${b64.error.replace(/^Not Base64: /, '')}` }
}

/**
 * RFC 4648 Base32 (A–Z, 2–7), the encoding every authenticator uses for
 * secrets. Decoding forgives what people paste: any letter case, spaces
 * (secrets are often shown in groups of four) and missing or present `=`
 * padding. Anything else is an error that says where and why.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export type Base32Result = { bytes: Uint8Array; normalized: string } | { error: string }

/** Character counts a Base32 string can never end on (they leave 1, 3 or 6 spare symbols). */
const IMPOSSIBLE_TAIL = new Set([1, 3, 6])

/** Digits the alphabet leaves out because they look like letters it keeps. */
const LOOKALIKES: Record<string, string> = { 0: 'O', 1: 'I or L', 8: 'B' }

export function decodeBase32(input: string): Base32Result {
  const compact = input.replace(/\s+/g, '').toUpperCase()
  if (!compact) return { error: 'The secret is empty' }

  const pad = /=+$/.exec(compact)
  const body = pad ? compact.slice(0, pad.index) : compact
  if (!body) return { error: 'The secret is only padding (=)' }

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ALPHABET.includes(ch)) continue
    const at = `character ${i + 1}${/\s/.test(input.trim()) ? ' (not counting spaces)' : ''}`
    if (ch === '=') return { error: `Padding (=) at ${at} — it may only appear at the end` }
    const lookalike = LOOKALIKES[ch]
    const hint = lookalike ? ` — Base32 has no ${ch}; did you mean ${lookalike}?` : ''
    return { error: `“${input.replace(/\s+/g, '')[i]}” at ${at} is not Base32 (A–Z and 2–7)${hint}` }
  }

  const tail = body.length % 8
  if (IMPOSSIBLE_TAIL.has(tail)) {
    return { error: `${body.length} characters is not a valid Base32 length — a character is missing or extra` }
  }
  if (pad && (body.length + pad[0].length) % 8 !== 0) {
    return { error: `Wrong amount of padding: ${pad[0].length} “=” after ${body.length} characters (padded Base32 is a multiple of 8 long)` }
  }

  const bytes = new Uint8Array(Math.floor((body.length * 5) / 8))
  let buffer = 0
  let bits = 0
  let out = 0
  for (const ch of body) {
    buffer = (buffer << 5) | ALPHABET.indexOf(ch)
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes[out++] = (buffer >>> bits) & 0xff
    }
  }
  return { bytes, normalized: body }
}

/** Unpadded, upper case — the form otpauth:// URIs carry. */
export function encodeBase32(bytes: Uint8Array): string {
  let out = ''
  let buffer = 0
  let bits = 0
  for (const byte of bytes) {
    buffer = ((buffer << 8) | byte) & 0xffff
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out += ALPHABET[(buffer >>> bits) & 31]
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31]
  return out
}

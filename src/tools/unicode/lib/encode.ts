/**
 * Byte forms and escapes for one code point or a whole grapheme. Hand-written
 * rather than TextEncoder so a lone surrogate can be reported as what it is
 * (unencodable in UTF-8 and UTF-32) instead of silently becoming U+FFFD.
 */

export const isSurrogate = (cp: number) => cp >= 0xd800 && cp <= 0xdfff

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0')
export const hex = (cp: number, width = 4) => cp.toString(16).toUpperCase().padStart(width, '0')
export const uPlus = (cp: number) => `U+${hex(cp)}`

/** UTF-8 bytes, or null for a lone surrogate (UTF-8 cannot encode one; TextEncoder writes EF BF BD). */
export function utf8(cp: number): number[] | null {
  if (isSurrogate(cp)) return null
  if (cp < 0x80) return [cp]
  if (cp < 0x800) return [0xc0 | (cp >> 6), 0x80 | (cp & 0x3f)]
  if (cp < 0x10000) return [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)]
  return [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)]
}

/** UTF-16 code units. A lone surrogate is itself one (unpaired) unit. */
export function utf16(cp: number): number[] {
  if (cp < 0x10000) return [cp]
  const v = cp - 0x10000
  return [0xd800 | (v >> 10), 0xdc00 | (v & 0x3ff)]
}

export const utf8Length = (cp: number) => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4)

export const bytesHex = (bytes: number[]) => bytes.map(hex2).join(' ')
export const unitsHex = (units: number[]) => units.map((u) => hex(u)).join(' ')

export function utf16Bytes(cp: number, littleEndian: boolean): string {
  return bytesHex(utf16(cp).flatMap((u) => (littleEndian ? [u & 0xff, u >> 8] : [u >> 8, u & 0xff])))
}

/** UTF-32 bytes, or null for a surrogate (not a Unicode scalar value). */
export function utf32Bytes(cp: number, littleEndian: boolean): string | null {
  if (isSurrogate(cp)) return null
  const bytes = [(cp >> 24) & 0xff, (cp >> 16) & 0xff, (cp >> 8) & 0xff, cp & 0xff]
  return bytesHex(littleEndian ? bytes.reverse() : bytes)
}

/** HTML numeric character reference. Browsers turn a surrogate reference into U+FFFD. */
export const htmlEscape = (cp: number) => `&#x${hex(cp, 1)};`
export const htmlDecimal = (cp: number) => `&#${cp};`

/** JavaScript: `\uXXXX` (pairs for astral) — valid in every engine and in JSON. */
export const jsEscape = (cp: number) => utf16(cp).map((u) => `\\u${hex(u)}`).join('')
/** JavaScript ES2015 code point escape. A surrogate here makes a lone one, as `\uD800` would. */
export const jsBraceEscape = (cp: number) => `\\u{${hex(cp, 1)}}`

/**
 * CSS escape: backslash plus hex. Every character of a grapheme is escaped, so
 * each escape is ended by the next backslash; only a literal hex digit or
 * space after the last one would need a terminating space, which the copy
 * leaves to the user. CSS turns a surrogate escape into U+FFFD.
 */
export const cssEscape = (cp: number) => `\\${hex(cp, 1)}`

/** Code points of a string, keeping lone surrogates as their own values. */
export function codePoints(text: string): number[] {
  const out: number[] = []
  for (const ch of text) out.push(ch.codePointAt(0)!)
  return out
}

export function escapeString(text: string, form: 'html' | 'js' | 'css'): string {
  const cps = codePoints(text)
  return cps.map(form === 'html' ? htmlEscape : form === 'js' ? jsEscape : cssEscape).join('')
}

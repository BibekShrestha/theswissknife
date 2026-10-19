/**
 * "Decode escapes" input mode: turns the escapes people paste from code and
 * bug reports into the characters they stand for, so a lone surrogate or a
 * bidi override can be inspected without first getting it into a textarea.
 *
 * Recognised: \uXXXX, \u{X…}, \xXX, \UXXXXXXXX, U+XXXX (4–6 hex digits),
 * &#xX…; and &#D…;. \uXXXX keeps UTF-16 semantics — `😀` is one
 * emoji, a lone `\uD800` stays a lone surrogate. Anything above U+10FFFF is
 * left as written and counted as invalid.
 */

const ESCAPE = /\\u\{([0-9A-Fa-f]{1,8})\}|\\u([0-9A-Fa-f]{4})|\\x([0-9A-Fa-f]{2})|\\U([0-9A-Fa-f]{8})|U\+([0-9A-Fa-f]{4,6})(?![0-9A-Fa-f])|&#[xX]([0-9A-Fa-f]{1,8});|&#([0-9]{1,8});/g

export interface Decoded {
  text: string
  decoded: number
  invalid: number
}

const fromValue = (value: number) => (value <= 0xffff ? String.fromCharCode(value) : String.fromCodePoint(value))

export function decodeEscapes(input: string): Decoded {
  let decoded = 0
  let invalid = 0
  const text = input.replace(ESCAPE, (match, brace, u4, x2, u8, uplus, hexRef, decRef) => {
    if (u4 !== undefined || x2 !== undefined) {
      decoded++
      return String.fromCharCode(parseInt(u4 ?? x2, 16))
    }
    const parsed = decRef !== undefined ? parseInt(decRef, 10) : parseInt(brace ?? u8 ?? uplus ?? hexRef, 16)
    if (parsed > 0x10ffff) {
      invalid++
      return match
    }
    decoded++
    return fromValue(parsed)
  })
  return { text, decoded, invalid }
}

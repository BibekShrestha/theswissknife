import { describe, expect, it } from 'vitest'
import { decodeBytes, decodeWindows1252, sniffEncoding } from './decode'

const utf8 = (text: string) => new TextEncoder().encode(text)

const withBom = (bom: number[], rest: Uint8Array) => {
  const out = new Uint8Array(bom.length + rest.length)
  out.set(bom)
  out.set(rest, bom.length)
  return out
}

/** "a,b" in UTF-16, written out by hand so the test does not depend on ICU. */
const utf16 = (text: string, littleEndian: boolean) => {
  const out = new Uint8Array(text.length * 2)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    out[i * 2 + (littleEndian ? 0 : 1)] = code & 0xff
    out[i * 2 + (littleEndian ? 1 : 0)] = code >> 8
  }
  return out
}

describe('sniffEncoding', () => {
  it('believes a byte-order mark', () => {
    expect(sniffEncoding(withBom([0xef, 0xbb, 0xbf], utf8('a,b')))).toEqual({
      encoding: 'utf-8',
      fromBom: true,
    })
    expect(sniffEncoding(withBom([0xff, 0xfe], utf16('a,b', true))).encoding).toBe('utf-16le')
    expect(sniffEncoding(withBom([0xfe, 0xff], utf16('a,b', false))).encoding).toBe('utf-16be')
  })

  it('finds UTF-16 with no mark from where the NUL bytes land', () => {
    const text = 'name,value\nrow,1\nrow,2\n'
    expect(sniffEncoding(utf16(text, true))).toEqual({ encoding: 'utf-16le', fromBom: false })
    expect(sniffEncoding(utf16(text, false))).toEqual({ encoding: 'utf-16be', fromBom: false })
  })

  it('does not call short ASCII UTF-16', () => {
    expect(sniffEncoding(utf8('a,b')).encoding).toBe('utf-8')
  })
})

describe('decodeBytes', () => {
  it('strips the BOM rather than leaving it in the first header cell', () => {
    const { text } = decodeBytes(withBom([0xef, 0xbb, 0xbf], utf8('id,name\n1,Ada')))
    expect(text.startsWith('id,name')).toBe(true)
  })

  it('round-trips UTF-16 in both byte orders', () => {
    expect(decodeBytes(utf16('id,name\n1,Ada\n', true)).text).toBe('id,name\n1,Ada\n')
    expect(decodeBytes(utf16('id,name\n1,Ada\n', false)).text).toBe('id,name\n1,Ada\n')
  })

  /**
   * The case that matters: a spreadsheet export from Windows. Decoded as
   * UTF-8 this is mojibake or U+FFFD, and U+FFFD cannot be undone.
   */
  it('falls back to Windows-1252 when the bytes are not valid UTF-8', () => {
    const bytes = new Uint8Array([0x6e, 0x61, 0x6d, 0x65, 0x0a, 0x43, 0x61, 0x66, 0xe9])
    const decoded = decodeBytes(bytes)
    expect(decoded.encoding).toBe('windows-1252')
    expect(decoded.text).toBe('name\nCafé')
    expect(decoded.text).not.toContain('�')
  })

  it('keeps valid UTF-8 as UTF-8', () => {
    const decoded = decodeBytes(utf8('name\nCafé éè'))
    expect(decoded.encoding).toBe('utf-8')
    expect(decoded.text).toBe('name\nCafé éè')
  })
})

describe('decodeWindows1252', () => {
  it('maps the 0x80-0x9F range Latin-1 leaves undefined', () => {
    // 0x80 euro, 0x93/0x94 curly quotes, 0x97 em dash
    expect(decodeWindows1252(new Uint8Array([0x80, 0x93, 0x94, 0x97]))).toBe('€“”—')
  })

  it('survives an input larger than one fromCharCode call', () => {
    const bytes = new Uint8Array(0x8000 * 2 + 5).fill(0x41)
    expect(decodeWindows1252(bytes)).toBe('A'.repeat(bytes.length))
  })
})

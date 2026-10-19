import { describe, expect, it } from 'vitest'
import check from './table.check.json'
import { explicitCount, nameOf, NAMES_VERSION } from './names'

/** CRC-32 (IEEE), as Python's zlib.crc32 computes it. */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(bytes: string, crc = 0): number {
  crc = ~crc >>> 0
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes.charCodeAt(i)) & 0xff] ^ (crc >>> 8)
  return ~crc >>> 0
}

describe('names table', () => {
  it('is pinned to the version the generator wrote', () => {
    expect(NAMES_VERSION).toBe(check.version)
    expect(explicitCount()).toBeGreaterThan(30000)
  })

  it('reproduces every name the source has, byte for byte', () => {
    // The generator CRCs `<HEX>;<NAME>\n` for every named code point; decoding
    // the front-coded table, the prefix runs and the Hangul rule must agree.
    let crc = 0
    let named = 0
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      const info = nameOf(cp)
      if (!info || info.kind === 'alias') continue
      crc = crc32(`${cp.toString(16).toUpperCase()};${info.name}\n`, crc)
      named++
    }
    expect(named).toBe(check.named)
    expect(crc).toBe(check.crc32)
  })

  it('names ordinary, algorithmic and alias-only characters', () => {
    expect(nameOf(0x41)).toEqual({ name: 'LATIN CAPITAL LETTER A', kind: 'name' })
    expect(nameOf(0x200b)?.name).toBe('ZERO WIDTH SPACE')
    expect(nameOf(0x202e)?.name).toBe('RIGHT-TO-LEFT OVERRIDE')
    expect(nameOf(0x1f600)?.name).toBe('GRINNING FACE')
    expect(nameOf(0x4e00)?.name).toBe('CJK UNIFIED IDEOGRAPH-4E00')
    expect(nameOf(0x17000)?.name).toBe('TANGUT IDEOGRAPH-17000')
    expect(nameOf(0xac00)?.name).toBe('HANGUL SYLLABLE GA')
    expect(nameOf(0xd4db)?.name).toBe('HANGUL SYLLABLE PWILH')
    expect(nameOf(0xd7a3)?.name).toBe('HANGUL SYLLABLE HIH')
    expect(nameOf(0x0a)).toEqual({ name: 'LINE FEED', kind: 'alias' })
    expect(nameOf(0x85)).toEqual({ name: 'NEXT LINE', kind: 'alias' })
    expect(nameOf(0xe0041)?.name).toBe('TAG LATIN CAPITAL LETTER A')
    expect(nameOf(0x10ffff)).toBeNull()
  })

  it('has no name for surrogates, private use or unassigned code points', () => {
    expect(nameOf(0xd800)).toBeNull()
    expect(nameOf(0xe000)).toBeNull()
    expect(nameOf(0x0378)).toBeNull()
  })
})

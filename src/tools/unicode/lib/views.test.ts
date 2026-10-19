import { describe, expect, it } from 'vitest'
import { analyze } from './analyze'
import { cssEscape, escapeString, htmlEscape, jsBraceEscape, jsEscape, utf16, utf16Bytes, utf32Bytes, utf8 } from './encode'
import { decodeEscapes } from './unescape'
import { buildPage, CP_CAP, cleanView, normalizeView, PAGE_SIZE, type NameLookup } from './views'

const names: NameLookup = (cp) => (cp === 0x430 ? { name: 'CYRILLIC SMALL LETTER A', kind: 'name' } : null)
const opts = { keepEmoji: true, plainSpaces: true }

describe('encodings and escapes', () => {
  it('writes UTF-8, UTF-16 and UTF-32', () => {
    expect(utf8(0x41)).toEqual([0x41])
    expect(utf8(0xe9)).toEqual([0xc3, 0xa9])
    expect(utf8(0x200b)).toEqual([0xe2, 0x80, 0x8b])
    expect(utf8(0x1f600)).toEqual([0xf0, 0x9f, 0x98, 0x80])
    for (const cp of [0x41, 0x7ff, 0x800, 0xffff, 0x10000, 0x10ffff]) {
      expect(utf8(cp)).toEqual([...new TextEncoder().encode(String.fromCodePoint(cp))])
    }
    expect(utf16(0x1f600)).toEqual([0xd83d, 0xde00])
    expect(utf16Bytes(0x1f600, false)).toBe('D8 3D DE 00')
    expect(utf16Bytes(0x1f600, true)).toBe('3D D8 00 DE')
    expect(utf32Bytes(0x1f600, false)).toBe('00 01 F6 00')
    expect(utf32Bytes(0x1f600, true)).toBe('00 F6 01 00')
  })

  it('refuses to invent bytes for a lone surrogate', () => {
    expect(utf8(0xd800)).toBeNull()
    expect(utf32Bytes(0xdc00, false)).toBeNull()
    expect(utf16(0xd800)).toEqual([0xd800])
  })

  it('escapes for HTML, JavaScript and CSS', () => {
    expect(htmlEscape(0x200b)).toBe('&#x200B;')
    expect(jsEscape(0x200b)).toBe('\\u200B')
    expect(jsEscape(0x1f600)).toBe('\\uD83D\\uDE00')
    expect(jsBraceEscape(0x1f600)).toBe('\\u{1F600}')
    expect(cssEscape(0x200b)).toBe('\\200B')
    const family = '👨\u200D👩'
    expect(escapeString(family, 'js')).toBe('\\uD83D\\uDC68\\u200D\\uD83D\\uDC69')
    expect(escapeString(family, 'html')).toBe('&#x1F468;&#x200D;&#x1F469;')
    expect(escapeString(family, 'css')).toBe('\\1F468\\200D\\1F469')
    // The JavaScript form evaluates back to the same string.
    expect(JSON.parse(`"${escapeString(family, 'js')}"`)).toBe(family)
  })
})

describe('decode escapes', () => {
  it('reads every supported spelling', () => {
    expect(decodeEscapes('a\\u200Bb').text).toBe('a\u200Bb')
    expect(decodeEscapes('\\uD83D\\uDE00').text).toBe('😀')
    expect(decodeEscapes('\\u{1F600} U+1F600 &#x1F600; &#128512; \\U0001F600').text).toBe('😀 😀 😀 😀 😀')
    expect(decodeEscapes('\\x41').text).toBe('A')
  })

  it('keeps a lone surrogate lone, and leaves impossible values alone', () => {
    const lone = decodeEscapes('x\\uD800y')
    expect(lone.text).toBe('x\uD800y')
    expect(lone.text.length).toBe(3)
    expect(decodeEscapes('U+D800').text).toBe('\uD800')
    const bad = decodeEscapes('\\u{110000}')
    expect(bad).toEqual({ text: '\\u{110000}', decoded: 0, invalid: 1 })
  })
})

describe('grapheme pages', () => {
  it('lists graphemes with their code points and flags', () => {
    const page = buildPage(analyze('p\u0430y\u200B👨\u200D👩\u200D👧'), 0, names)
    expect(page.total).toBe(5)
    expect(page.graphemes.map((g) => g.text)).toEqual(['p', '\u0430', 'y', '\u200B', '👨\u200D👩\u200D👧'])
    expect(page.graphemes[1].cps[0]).toMatchObject({ cp: 0x430, name: 'CYRILLIC SMALL LETTER A', gc: 'Ll', script: 'Cyrillic', flags: ['mixed', 'lookalike'] })
    expect(page.graphemes[3].cps[0].flags).toEqual(['invisible'])
    expect(page.graphemes[4].emoji).toBe(true)
    expect(page.graphemes[4].cps[1].flags).toEqual(['emoji'])
  })

  it('pages large input and caps code points per grapheme', () => {
    const text = 'x'.repeat(PAGE_SIZE * 2 + 5) + 'Z' + '\u0301'.repeat(100)
    const a = analyze(text)
    const last = buildPage(a, 99, null)
    expect(last.pages).toBe(3)
    expect(last.index).toBe(2)
    expect(last.graphemes.length).toBe(6)
    const zalgo = last.graphemes[5]
    expect(zalgo.cps.length).toBe(CP_CAP)
    expect(zalgo.more).toBe(101 - CP_CAP)
  })

  it('works without the names table', () => {
    expect(buildPage(analyze('a'), 0, null).graphemes[0].cps[0].name).toBeNull()
  })
})

describe('normalisation view', () => {
  it('shows what each form changes', () => {
    const text = 'Cafe\u0301 ﬁle Ａ'
    const nfc = normalizeView(analyze(text), 'NFC')
    expect(nfc.output).toBe('Café ﬁle Ａ')
    expect(nfc.changed).toBe(1)
    expect(nfc.changes[0]).toMatchObject({ before: 'e\u0301', after: 'é' })
    expect(nfc.codePointsAfter).toBe(nfc.codePointsBefore - 1)
    const nfkc = normalizeView(analyze(text), 'NFKC')
    expect(nfkc.output).toBe('Café file A')
    expect(nfkc.changed).toBe(3)
    expect(nfkc.unchanged).toEqual({ NFC: false, NFD: true, NFKC: false, NFKD: false }) // already decomposed
    expect(normalizeView(analyze('plain'), 'NFD').unchanged).toEqual({ NFC: true, NFD: true, NFKC: true, NFKD: true })
    expect(nfkc.crossesGraphemes).toBe(false)
  })
})

describe('strip and reveal', () => {
  it('strips invisibles, bidi controls, tags, stray selectors and BOMs', () => {
    const text = '\uFEFFpass\u200Bword \u202Eevil\u202C a\uFE0F x\u0007y'
    const view = cleanView(analyze(text), opts, null)
    expect(view.stripped).toBe('password evil a xy')
    expect(view.removed).toBe(6)
    expect(view.byKind).toMatchObject({ bom: 1, invisible: 1, bidi: 2, variation: 1, control: 1 })
  })

  it('keeps emoji sequences whole unless told otherwise', () => {
    const family = '👨\u200D👩\u200D👧'
    expect(cleanView(analyze(family), opts, null).stripped).toBe(family)
    expect(cleanView(analyze(family), { ...opts, keepEmoji: false }, null).stripped).toBe('👨👩👧')
  })

  it('turns odd spaces into plain ones, or keeps them', () => {
    const text = 'a\u00A0b\u2028c'
    expect(cleanView(analyze(text), opts, null).stripped).toBe('a b\nc')
    expect(cleanView(analyze(text), { ...opts, plainSpaces: false }, null).stripped).toBe(text)
  })

  it('never touches combining marks or look-alike letters when stripping', () => {
    const text = 'Cafe\u0301 p\u0430ypal'
    expect(cleanView(analyze(text), opts, null).stripped).toBe(text)
  })

  it('removes lone surrogates', () => {
    expect(cleanView(analyze('a\uD800b'), opts, null).stripped).toBe('ab')
  })

  it('reveals hidden characters as labels, tags as the text they spell', () => {
    const tags = [...'run rm'].map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('')
    const text = `hi${tags} a\u200Bb \u202E p\u0430y`
    const view = cleanView(analyze(text), opts, names)
    expect(view.revealed).toBe('hi[TAGS “run rm”] a[U+200B ZWSP]b [U+202E RLO] p[U+0430 looks like “a”]y')
    expect(view.revealed).not.toMatch(/[\u200B\u202E\u{E0000}-\u{E007F}]/u)
  })

  it('keeps line structure when revealing separators', () => {
    expect(cleanView(analyze('a\u2028b'), opts, null).revealed).toBe('a[U+2028 LSEP]\nb')
  })
})

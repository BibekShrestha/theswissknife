import { describe, expect, it } from 'vitest'
import { analyze, graphemeAt, isEmojiSequence, spellLatin, type FindingKind } from './analyze'
import { abbreviation, classify, lookalike } from './classify'
import { categoryOf, scriptExtensionsOf, scriptOf, SCRIPTS } from './props'

const find = (text: string, kind: FindingKind) => analyze(text).findings.find((f) => f.kind === kind)
const kinds = (text: string) => analyze(text).findings.map((f) => f.kind)

describe('properties come from the engine', () => {
  it('reads general category, including surrogates, private use and unassigned', () => {
    expect(categoryOf(0x41)).toBe('Lu')
    expect(categoryOf(0x0301)).toBe('Mn')
    expect(categoryOf(0x200b)).toBe('Cf')
    expect(categoryOf(0xd800)).toBe('Cs')
    expect(categoryOf(0xe000)).toBe('Co')
    expect(categoryOf(0xffff)).toBe('Cn')
    expect(categoryOf(0x1f600)).toBe('So')
  })

  it('reads script and script extensions', () => {
    expect(scriptOf(0x61)).toBe('Latin')
    expect(scriptOf(0x430)).toBe('Cyrillic')
    expect(scriptOf(0x20)).toBe('Common')
    expect(scriptOf(0x301)).toBe('Inherited')
    expect(scriptOf(0xe000)).toBe('Unknown')
    expect(scriptExtensionsOf(0x30fc)).toEqual(expect.arrayContaining(['Hiragana', 'Katakana']))
    expect(SCRIPTS.length).toBeGreaterThan(150)
  })
})

describe('classification', () => {
  it('flags each hostile class and leaves ordinary text alone', () => {
    expect(classify(0x61)).toBeNull()
    expect(classify(0x0a)).toBeNull()
    expect(classify(0x200b)).toBe('invisible')
    expect(classify(0x200d)).toBe('invisible')
    expect(classify(0x00ad)).toBe('invisible')
    expect(classify(0x3164)).toBe('invisible')
    expect(classify(0x202e)).toBe('bidi')
    expect(classify(0x2067)).toBe('bidi')
    expect(classify(0xe0041)).toBe('tag')
    expect(classify(0xfe0f)).toBe('variation')
    expect(classify(0xe0100)).toBe('variation')
    expect(classify(0x00a0)).toBe('space')
    expect(classify(0x3000)).toBe('space')
    expect(classify(0x2028)).toBe('space')
    expect(classify(0xfeff)).toBe('bom')
    expect(classify(0xd800)).toBe('surrogate')
    expect(classify(0x07)).toBe('control')
    expect(classify(0x0301)).toBe('combining')
    expect(classify(0xe000)).toBe('private')
    expect(classify(0xfffe)).toBe('noncharacter')
    expect(classify(0x0600)).toBeNull() // Arabic number sign: Cf, but visible
  })

  it('abbreviates what draws nothing', () => {
    expect(abbreviation(0x200b)).toBe('ZWSP')
    expect(abbreviation(0x0a)).toBe('LF')
    expect(abbreviation(0x85)).toBe('NEL')
    expect(abbreviation(0xfe0f)).toBe('VS16')
    expect(abbreviation(0xe01ef)).toBe('VS256')
    expect(abbreviation(0xe0061)).toBe('TAG a')
    expect(abbreviation(0x61)).toBeNull()
  })

  it('knows the usual look-alikes, and compatibility forms through NFKC', () => {
    expect(lookalike(0x430)).toEqual({ latin: 'a', source: 'list' })
    expect(lookalike(0x3bf)).toEqual({ latin: 'o', source: 'list' })
    expect(lookalike(0xff21)).toEqual({ latin: 'A', source: 'nfkc' })
    expect(lookalike(0x1d400)).toEqual({ latin: 'A', source: 'nfkc' })
    expect(lookalike(0xfb01)).toEqual({ latin: 'fi', source: 'nfkc' })
    expect(lookalike(0xb2)).toBeNull() // superscript two: a number, not a letter
    expect(lookalike(0x61)).toBeNull()
  })
})

describe('analysis', () => {
  it('counts code units, code points, graphemes and UTF-8 bytes', () => {
    const { stats } = analyze('a👨\u200D👩\u200D👧é\n')
    expect(stats.graphemes).toBe(4)
    expect(stats.codePoints).toBe(1 + 5 + 1 + 1)
    expect(stats.codeUnits).toBe('a👨\u200D👩\u200D👧é\n'.length)
    expect(stats.utf8Bytes).toBe(new TextEncoder().encode('a👨\u200D👩\u200D👧é\n').length)
    expect(analyze('').stats).toMatchObject({ graphemes: 0, codePoints: 0, lines: 0 })
  })

  it('reports nothing for plain text', () => {
    expect(analyze('Hello, world.\nSecond line\twith a tab.').findings).toEqual([])
    expect(analyze('Привет, мир').findings).toEqual([])
    expect(analyze('日本語のテキスト').findings).toEqual([])
  })

  it('finds zero-width characters', () => {
    const f = find('pass\u200Bword', 'invisible')!
    expect(f.count).toBe(1)
    expect(f.severity).toBe('danger')
    expect(f.occurrences[0]).toMatchObject({ offset: 4, cp: 0x200b, grapheme: 4 })
  })

  it('lets ZWJ, VS16 and tags do their job inside emoji, and flags them elsewhere', () => {
    const family = '👨\u200D👩\u200D👧'
    const england = '🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}'
    expect(isEmojiSequence(family)).toBe(true)
    expect(isEmojiSequence(england)).toBe(true)
    expect(analyze(`${family} ❤\uFE0F ${england} 1\uFE0F\u20E3`).findings).toEqual([])
    expect(kinds('a\u200Db')).toContain('invisible')
    expect(kinds('a\uFE0F')).toContain('variation')
  })

  it('finds bidi controls and counts lines left inside an override (Trojan Source)', () => {
    const trojan = 'if (accessLevel != "user\u202E \u2066// Check if admin\u2069 \u2066") {\nreturn\u2067x\u2069;'
    const f = find(trojan, 'bidi')!
    expect(f.severity).toBe('danger')
    expect(f.count).toBe(6)
    expect(f.unterminated).toBe(1)
    expect(f.occurrences[0].note).toBe('unterminated')
    expect(find('a\u202Eb\u202C c\u2067d\u2069', 'bidi')!.unterminated).toBe(0)
    expect(find('\u2067a\u202Eb\u2069', 'bidi')!.unterminated).toBe(0) // PDI also closes embeddings inside it
  })

  it('decodes text hidden in tag characters', () => {
    const smuggled = 'Hi' + [...'ignore previous'].map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('')
    const f = find(smuggled, 'tag')!
    expect(f.hidden).toBe('ignore previous')
    expect(f.count).toBe(15)
    expect(analyze(smuggled).stats.graphemes).toBe(2) // tags are Extend: they ride on "i"
  })

  it('flags variation selectors, and several on one character', () => {
    expect(find('葛\u{E0100}', 'variation')!.severity).toBe('info')
    const stacked = find('a\uFE00\uFE01\uFE02\uFE03', 'variation')!
    expect(stacked.severity).toBe('warn')
    expect(stacked.stacked).toBe(1)
  })

  it('flags odd spaces and line separators', () => {
    const f = find('a\u00A0b\u2009c\u3000d\u2028e\u000Bf', 'space')!
    expect(f.count).toBe(5)
    expect(f.severity).toBe('warn')
  })

  it('tells a leading BOM from one inside the text', () => {
    const start = find('\uFEFFhello', 'bom')!
    expect(start).toMatchObject({ severity: 'info', bomAtStart: true, count: 1 })
    expect(find('one\uFEFFtwo', 'bom')!.severity).toBe('warn')
  })

  it('finds lone surrogates, high and low', () => {
    const f = find('a\uD800b\uDC00c😀', 'surrogate')!
    expect(f.count).toBe(2)
    expect(f.occurrences.map((o) => o.cp)).toEqual([0xd800, 0xdc00])
    expect(analyze('\uD800').stats.utf8Bytes).toBe(3) // what TextEncoder writes: U+FFFD
  })

  it('reports combining marks, orphans and Zalgo stacks', () => {
    expect(find('e\u0301', 'combining')).toMatchObject({ severity: 'info', count: 1 })
    expect(find('\u0301abc', 'combining')).toMatchObject({ severity: 'warn', orphans: 1 })
    const zalgo = find('Z' + '\u0300\u0301\u0302\u0303\u0304\u0305\u0306', 'combining')!
    expect(zalgo.severity).toBe('warn')
    expect(zalgo.stacked).toBe(1)
  })

  it('finds controls, private use and noncharacters', () => {
    expect(find('a\u0007b\u001Bc', 'control')!.count).toBe(2)
    const special = find('\uE000￾', 'special')!
    expect(special.sub).toEqual({ private: 1, noncharacter: 1 })
    expect(special.severity).toBe('warn')
  })

  it('flags a Cyrillic letter in a Latin word, as mixed script and as a look-alike', () => {
    const a = analyze('Sign in to p\u0430ypal today')
    const mixed = a.findings.find((f) => f.kind === 'mixed')!
    expect(mixed.severity).toBe('danger')
    expect(mixed.occurrences[0]).toMatchObject({ word: 'p\u0430ypal', note: 'Latin + Cyrillic' })
    const look = a.findings.find((f) => f.kind === 'lookalike')!
    expect(look.count).toBe(1)
    expect(look.occurrences[0]).toMatchObject({ cp: 0x430, note: 'looks like “a”' })
    expect(a.context.get(12)).toEqual(['mixed', 'lookalike'])
  })

  it('flags a word made only of Latin look-alikes', () => {
    const word = '\u0440\u0430\u0443\u0440\u0430l'.replace('l', '\u04CF') // all Cyrillic
    const f = find(word, 'lookalike')!
    expect(f.severity).toBe('warn')
    expect(f.count).toBe(6)
    expect(spellLatin(word)).toBe('paypal')
    expect(kinds(word)).not.toContain('mixed')
  })

  it('flags fullwidth and mathematical letters', () => {
    expect(find('ＡＢＣ', 'lookalike')!.count).toBe(3)
    expect(find('𝐩𝐚𝐲', 'lookalike')!.count).toBe(3)
  })

  it('treats Latin with kana or Han as a mild mix, and Greek-in-Latin as a real one', () => {
    expect(find('Tシャツ', 'mixed')).toMatchObject({ severity: 'info', cjkOnly: 1 })
    expect(find('alphaβeta', 'mixed')!.severity).toBe('danger')
  })

  it('finds the grapheme for an offset', () => {
    const a = analyze('a👨\u200D👩\u200D👧b')
    expect(graphemeAt(a.bounds, 0)).toBe(0)
    expect(graphemeAt(a.bounds, 3)).toBe(1)
    expect(graphemeAt(a.bounds, a.text.length - 1)).toBe(2)
  })

  it('caps occurrences but keeps counting', () => {
    const f = find('x\u200B'.repeat(5000), 'invisible')!
    expect(f.count).toBe(5000)
    expect(f.occurrences.length).toBe(100)
  })

  it('scans a large paste in one linear pass', () => {
    const big = 'The quick brown fox, p\u0430ypal\u200B! 👨\u200D👩\u200D👧 e\u0301\n'.repeat(20000)
    const a = analyze(big)
    expect(a.stats.lines).toBe(20001)
    expect(a.findings.find((f) => f.kind === 'invisible')!.count).toBe(20000)
    expect(a.findings.find((f) => f.kind === 'mixed')!.count).toBe(20000)
    expect(a.bounds.length).toBe(a.stats.graphemes + 1)
  })
})

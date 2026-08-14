import { describe, expect, it } from 'vitest'
import { PRESETS } from './patterns'
import {
  DEFAULT_OPTIONS,
  findRanges,
  graphemes,
  leaks,
  measure,
  mergeRanges,
  normalizeMask,
  redact,
  redactRanges,
  type RedactOptions,
  type Target,
} from './redact'

const options = (over: Partial<RedactOptions> = {}): RedactOptions => ({
  ...DEFAULT_OPTIONS,
  ...over,
})

/** The example from issue #15, kept verbatim as the acceptance test. */
const ISSUE_INPUT = "Your heart's been aching, but you're too shy to say it\nNGGYU"

describe('redact — the example from issue #15', () => {
  it('keeps spaces, so each word keeps its length', () => {
    expect(redact(ISSUE_INPUT, options({ spaces: 'keep' }))).toBe(
      '████ ███████ ████ ███████ ███ ██████ ███ ███ ██ ███ ██\n█████',
    )
  })

  it('drops spaces, leaving one run per line', () => {
    expect(redact(ISSUE_INPUT, options({ spaces: 'remove' }))).toBe(
      '████████████████████████████████████████████\n█████',
    )
  })
})

describe('redact', () => {
  it('masks punctuation like any other character', () => {
    expect(redact("don't, ok?", options())).toBe('██████ ███')
  })

  it('can mask the spaces too, keeping the line length', () => {
    expect(redact('ab cd', options({ spaces: 'redact' }))).toBe('█████')
  })

  it('uses whichever mask character is asked for', () => {
    expect(redact('hi there', options({ mask: '░' }))).toBe('░░ ░░░░░')
    expect(redact('hi', options({ mask: '●' }))).toBe('●●')
  })

  it('keeps line breaks exactly as they came in', () => {
    expect(redact('a\nb\r\nc\rd', options())).toBe('█\n█\r\n█\r█')
    expect(redact('a\n\n\nb', options())).toBe('█\n\n\n█')
    expect(redact('trailing\n', options())).toBe('████████\n')
  })

  it('keeps tabs and non-breaking spaces when spaces are kept', () => {
    expect(redact('a\tb c', options({ spaces: 'keep' }))).toBe('█\t█ █')
    expect(redact('a\tb c', options({ spaces: 'remove' }))).toBe('███')
    expect(redact('a\tb c', options({ spaces: 'redact' }))).toBe('█████')
  })

  it('counts an emoji as one character, however many code points it holds', () => {
    // family emoji: 7 code points, 11 UTF-16 units, one thing a reader sees
    expect(redact('👨‍👩‍👧‍👦', options())).toBe('█')
    expect(redact('a👍b', options())).toBe('███')
  })

  it('counts a letter and its combining accent as one character', () => {
    expect(redact('é', options())).toBe('█') // e + combining acute
    expect(redact('é', options())).toBe('█') // precomposed
  })

  it('leaves empty input empty', () => {
    expect(redact('', options())).toBe('')
    expect(redact('   ', options({ spaces: 'remove' }))).toBe('')
  })

  it('does not lengthen the text when the mask is a wide character', () => {
    // one grapheme in, one grapheme out, whatever the mask is
    expect(graphemes(redact('abcd', options({ mask: '🟥' })))).toHaveLength(4)
  })
})

describe('redactRanges', () => {
  const text = 'call bob at bob@example.com now'

  it('masks only what the ranges cover', () => {
    // "bob@example.com" starts at 12; punctuation inside it is masked too, so
    // the shape of the address does not survive either
    expect(redactRanges(text, [{ start: 12, end: 27 }], options())).toBe(
      'call bob at ███████████████ now',
    )
  })

  it('leaves the text alone when nothing is picked', () => {
    expect(redactRanges(text, [], options())).toBe(text)
  })

  it('applies the space setting inside the masked span only', () => {
    expect(redactRanges('keep this: a b c', [{ start: 11, end: 16 }], options({ spaces: 'remove' })))
      .toBe('keep this: ███')
    expect(redactRanges('keep this: a b c', [{ start: 11, end: 16 }], options({ spaces: 'redact' })))
      .toBe('keep this: █████')
  })

  it('never splits a grapheme, even when a range lands mid-character', () => {
    const emoji = 'a👍b' // the thumb is two UTF-16 units at offsets 1–3
    expect(redactRanges(emoji, [{ start: 1, end: 2 }], options())).toBe('a█b')
  })

  it('keeps line breaks inside a masked span', () => {
    expect(redactRanges('one\ntwo', [{ start: 0, end: 7 }], options({ spaces: 'redact' }))).toBe(
      '███\n███',
    )
  })

  it('handles overlapping and unsorted ranges', () => {
    expect(
      redactRanges('abcdefgh', [{ start: 4, end: 6 }, { start: 0, end: 2 }, { start: 1, end: 5 }], options()),
    ).toBe('██████gh')
  })
})

describe('mergeRanges', () => {
  it('sorts, merges overlaps and joins touching ranges', () => {
    expect(mergeRanges([{ start: 5, end: 8 }, { start: 0, end: 3 }, { start: 2, end: 6 }])).toEqual([
      { start: 0, end: 8 },
    ])
    expect(mergeRanges([{ start: 0, end: 2 }, { start: 2, end: 4 }])).toEqual([{ start: 0, end: 4 }])
  })

  it('keeps genuinely separate ranges apart and drops empty ones', () => {
    expect(mergeRanges([{ start: 0, end: 2 }, { start: 5, end: 7 }, { start: 9, end: 9 }])).toEqual([
      { start: 0, end: 2 },
      { start: 5, end: 7 },
    ])
  })
})

describe('findRanges', () => {
  const target = (value: string, kind: Target['kind'] = 'literal'): Target => ({ kind, value })

  it('finds every occurrence of a literal, ignoring case by default', () => {
    const report = findRanges('Bob and bob', [target('bob')])
    expect(report.counts).toEqual([2])
    expect(report.ranges).toEqual([{ start: 0, end: 3 }, { start: 8, end: 11 }])
  })

  it('respects case when asked', () => {
    expect(findRanges('Bob and bob', [target('bob')], { caseSensitive: true }).counts).toEqual([1])
  })

  it('treats literals literally, not as patterns', () => {
    const report = findRanges('costs $5.00 (net)', [target('$5.00'), target('(net)')])
    expect(report.counts).toEqual([1, 1])
  })

  it('reports an invalid pattern instead of throwing', () => {
    const report = findRanges('anything', [target('[unclosed', 'regex')])
    expect(report.counts).toEqual([0])
    expect(report.errors[0]).toBeTruthy()
    expect(report.ranges).toEqual([])
  })

  it('does not spin on a pattern that can match nothing', () => {
    const report = findRanges('abc', [target('x*', 'regex')])
    expect(report.counts).toEqual([0])
  })

  it('counts each target separately but merges their ranges', () => {
    const report = findRanges('bob@example.com', [target('bob'), target('bob@example.com')])
    expect(report.counts).toEqual([1, 1])
    expect(report.ranges).toEqual([{ start: 0, end: 15 }])
  })

  it('stops at MAX_MATCHES rather than eating the tab', () => {
    const report = findRanges('a'.repeat(30_000), [target('a')])
    expect(report.truncated).toBe(true)
    expect(report.counts[0]).toBeLessThanOrEqual(20_000)
  })
})

describe('presets', () => {
  const line =
    'mail dana.whitfield@example.com from 10.4.19.7 see https://ops.example.com/x?a=1 token sk_live_9f3ac1b8d47e2205 id 4821'

  const hits = (id: string) => {
    const preset = PRESETS.find((candidate) => candidate.id === id)!
    const report = findRanges(line, [{ kind: 'regex', value: preset.value }])
    return report.ranges.map((range) => line.slice(range.start, range.end))
  }

  it('catches emails, addresses, URLs, tokens and long numbers', () => {
    expect(hits('email')).toEqual(['dana.whitfield@example.com'])
    expect(hits('ip')).toEqual(['10.4.19.7'])
    expect(hits('url')).toEqual(['https://ops.example.com/x?a=1'])
    expect(hits('token')).toEqual(['sk_live_9f3ac1b8d47e2205'])
    expect(hits('digits')).toEqual(['4821'])
  })

  it('every preset compiles', () => {
    for (const preset of PRESETS) {
      expect(findRanges('sample', [{ kind: 'regex', value: preset.value }]).errors[0]).toBeNull()
    }
  })

  it('redacts a whole document down to just its secrets', () => {
    const targets: Target[] = PRESETS.filter((p) => ['email', 'ip'].includes(p.id)).map((p) => ({
      kind: 'regex',
      value: p.value,
    }))
    const report = findRanges(line, targets)
    const out = redactRanges(line, report.ranges, options())
    expect(out).toContain('mail ██████████████████████████ from █████████ see https://')
  })
})

describe('normalizeMask', () => {
  it('takes the first grapheme of a longer string', () => {
    expect(normalizeMask('███')).toBe('█')
    expect(normalizeMask('xy')).toBe('x')
    expect(normalizeMask('👍🏽!')).toBe('👍🏽')
  })

  it('falls back to a full block for empty or blank input', () => {
    expect(normalizeMask('')).toBe('█')
    expect(normalizeMask(' ')).toBe('█')
    expect(normalizeMask('\t')).toBe('█')
  })
})

describe('measure', () => {
  it('counts characters, spaces, words and lines the way a reader would', () => {
    expect(measure('Your heart\nNGGYU')).toEqual({ masked: 14, spaces: 1, words: 3, lines: 2 })
  })

  it('counts runs of whitespace as one word boundary', () => {
    expect(measure('a   b')).toMatchObject({ words: 2, spaces: 3, masked: 2 })
  })

  it('counts blank lines', () => {
    expect(measure('a\n\nb')).toMatchObject({ lines: 3, words: 2 })
  })

  it('handles the empty string without inventing a word', () => {
    expect(measure('')).toEqual({ masked: 0, spaces: 0, words: 0, lines: 1 })
  })
})

describe('leaks', () => {
  it('warns that keeping spaces exposes every word length', () => {
    const notes = leaks(ISSUE_INPUT, options({ spaces: 'keep' }))
    expect(notes[0]).toMatch(/word's length/)
    expect(notes[0]).toContain('12 words') // 11 on the first line, plus NGGYU
  })

  it('reports only a character count once spaces are gone', () => {
    const notes = leaks(ISSUE_INPUT, options({ spaces: 'remove' }))
    expect(notes.join(' ')).not.toMatch(/word/)
    expect(notes[0]).toMatch(/character count/)
  })

  it('mentions indentation only when there is some', () => {
    expect(leaks('  indented', options()).join(' ')).toMatch(/indentation/)
    expect(leaks('flush left', options()).join(' ')).not.toMatch(/indentation/)
  })

  it('mentions line structure only for multi-line text', () => {
    expect(leaks('one line', options()).join(' ')).not.toMatch(/line structure/)
    expect(leaks('two\nlines', options()).join(' ')).toMatch(/line structure/)
  })
})

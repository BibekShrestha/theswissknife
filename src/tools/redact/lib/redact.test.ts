import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OPTIONS,
  graphemes,
  leaks,
  measure,
  normalizeMask,
  redact,
  type RedactOptions,
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

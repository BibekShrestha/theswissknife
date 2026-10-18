import { describe, expect, it } from 'vitest'
import { explainPattern, type ExplainNode } from './explain'
import { parseRegex } from './parser'
import { findBacktrackRisks } from './redos'

function explain(pattern: string, flags = ''): ExplainNode[] {
  const parsed = parseRegex(pattern, flags)
  if (!parsed.ok) throw new Error(parsed.error.message)
  return explainPattern(pattern, parsed.pattern, flags)
}

/** label ← source, indented by depth: a readable snapshot of the tree. */
function outline(nodes: ExplainNode[], depth = 0): string[] {
  return nodes.flatMap((n) => [`${'  '.repeat(depth)}${n.label} ← ${n.source}`, ...outline(n.children, depth + 1)])
}

function risks(pattern: string, flags = '') {
  const parsed = parseRegex(pattern, flags)
  if (!parsed.ok) throw new Error(parsed.error.message)
  return findBacktrackRisks(pattern, parsed.pattern, flags)
}

describe('explanation tree', () => {
  it('explains alternation, groups and quantifiers', () => {
    expect(outline(explain('^(?<year>\\d{4})-(?:0[1-9]|1[0-2])$'))).toEqual([
      'Start of the input ← ^',
      'Named capture group "year" (#1) ← (?<year>\\d{4})',
      '  Exactly 4 times ← \\d{4}',
      '    A digit 0–9 ← \\d',
      'Character "-" ← -',
      'Group (non-capturing) ← (?:0[1-9]|1[0-2])',
      '  Either of 2 alternatives, tried left to right ← 0[1-9]|1[0-2]',
      '    Alternative 1 ← 0[1-9]',
      '      Character "0" ← 0',
      '      One of ← [1-9]',
      '        Range "1" to "9" ← 1-9',
      '    Alternative 2 ← 1[0-2]',
      '      Character "1" ← 1',
      '      One of ← [0-2]',
      '        Range "0" to "2" ← 0-2',
      'End of the input ← $',
    ])
  })

  it('merges literal runs and keeps a quantifier on its own character', () => {
    expect(outline(explain('abc+'))).toEqual([
      'Literal text "ab" ← ab',
      'One or more times, greedy — as many as possible ← c+',
      '  Character "c" ← c',
    ])
  })

  it('describes lazy quantifiers and lookarounds', () => {
    const lines = outline(explain('(?<=\\$)\\d+?(?!\\.)'))
    expect(lines[0]).toBe('Lookbehind: preceded by ← (?<=\\$)')
    expect(lines).toContain('One or more times, lazy — as few as possible ← \\d+?')
    expect(lines).toContain('Negative lookahead: not followed by ← (?!\\.)')
  })

  it('follows flags, and modifiers groups that change them', () => {
    expect(explain('^.', 'ms').map((n) => n.label)).toEqual(['Start of a line (m flag)', 'Any character, including line terminators (s flag)'])
    const modifier = explain('(?s-m:^.)', 'm')[0]
    expect(modifier.label).toBe('Group with flags changed inside: dotAll on, multiline off')
    expect(modifier.children.map((n) => n.label)).toEqual(['Start of the input', 'Any character, including line terminators (s flag)'])
  })

  it('explains v-flag set operations, strings and properties', () => {
    expect(outline(explain('[\\p{L}--[a-z]]', 'v'))).toEqual([
      'A character in the first set but not in the others (subtraction) ← [\\p{L}--[a-z]]',
      '  A character with General_Category=Letter (L) ← \\p{L}',
      '  One of ← [a-z]',
      '    Range "a" to "z" ← a-z',
    ])
    expect(explain('[\\q{abc|d}]', 'v')[0].children[0].label).toBe('One of the strings "abc", "d"')
    expect(explain('\\p{RGI_Emoji}', 'v')[0].label).toBe('An emoji sequence or string with property RGI_Emoji (v flag)')
    expect(explain('\\P{Script=Greek}', 'u')[0].label).toBe('A character without Script=Greek')
  })

  it('explains back-references, including ones that can only match empty', () => {
    expect(explain('(a)\\1')[1].label).toBe('Back-reference: the same text group #1 matched')
    expect(explain('\\1(a)')[0].note).toMatch(/later in the pattern/)
    expect(explain('(?<n>a\\k<n>)')[0].children[1].note).toMatch(/inside the group/)
  })

  it('flags Annex B escapes and names control characters', () => {
    expect(explain('\\12')[0]).toMatchObject({ label: 'Character line feed (newline) (U+000A)', note: expect.stringMatching(/octal/) })
    expect(explain('\\q')[0].note).toMatch(/only allowed without the u or v flag/)
    expect(explain('\\t\\0')[0].children.map((n) => n.label)).toEqual(['Character tab (U+0009)', 'Character NUL (U+0000)'])
  })

  it('describes the empty pattern and empty alternatives', () => {
    expect(explain('')).toEqual([])
    expect(outline(explain('a|'))[3]).toBe('  Alternative 2: nothing (always matches, empty) ← ')
  })

  it('explains every pattern in a broad corpus without throwing', () => {
    const corpus: [string, string][] = [
      ['(?:(?<a>x)|(?<a>y))\\k<a>', ''], ['[^\\d\\s-]', ''], ['\\cJ\\x41\\u0041\\u{41}', 'u'], ['[\\b]', ''],
      ['(?i:a)(?-i:b)', ''], ['a{2,}?b{3,5}', ''], ['(?=a)*', ''], ['[\\w&&\\p{ASCII}]', 'v'], ['[^[^a]]', 'v'],
      ['\\p{scx=Hira}+', 'u'], ['(((a)))', ''], ['[😀-😁]', 'u'], ['😀', ''],
    ]
    for (const [pattern, flags] of corpus) expect(() => explain(pattern, flags)).not.toThrow()
  })
})

describe('catastrophic backtracking warnings', () => {
  it.each([
    ['(a+)+b'], ['(a*)*'], ['(\\w+\\s?)*$'], ['(?:a*b*)*c'], ['(x+x?)+y'], ['^(\\d+)*$'], ['(a|a)*b'], ['(\\w|\\d)+$'],
    ['(.|\\s)*z'], ['([a-z]|[aeiou])+!'], ['(a+){10,}'],
  ])('warns about %s', (pattern) => {
    expect(risks(pattern)).not.toEqual([])
  })

  it.each([
    ['a+b+'], ['(ab)+'], ['(a+b)+'], ['(\\w+\\.)+com'], ['(a|b)*'], ['(.|\\n)*'], ['\\d{3}-\\d{4}'], ['(a+)?'], ['(?:\\s*,\\s*\\w+)*'],
    ['[a-z]+@[a-z]+'],
  ])('stays quiet about %s', (pattern) => {
    expect(risks(pattern)).toEqual([])
  })

  it('points at the outer repetition and names both parts', () => {
    const [warning] = risks('x(a+)+y')
    expect(warning).toMatchObject({ start: 1, end: 6 })
    expect(warning.message).toContain('"a+" repeats inside "(a+)+"')
  })

  it('folds case when the i flag is on', () => {
    expect(risks('(a|A)+$')).toEqual([])
    expect(risks('(a|A)+$', 'i')).not.toEqual([])
  })
})

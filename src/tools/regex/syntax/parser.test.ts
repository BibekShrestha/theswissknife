import { describe, expect, it } from 'vitest'
import type { Node } from './ast'
import { parseRegex } from './parser'

/** What the engine running these tests says — the ground truth for validity. */
function engineAccepts(pattern: string, flags: string): boolean {
  try {
    new RegExp(pattern, flags)
    return true
  } catch {
    return false
  }
}

const MODES = ['', 'u', 'v'] as const

/** Hand-picked: one line per grammar corner, valid and invalid alike. */
const CORPUS = [
  // basics
  '', 'abc', 'a|b|', '|', 'a.b', '^a$', '\\bword\\B', 'a*b+c?', 'a*?b+?c??', 'a{2}', 'a{2,}', 'a{2,5}', 'a{2,5}?',
  'a{5,2}', 'a{,5}', 'a{', 'a{1', 'a{1,', '{', '}', ']', '{1}', 'x{1}{2}', 'a**', 'a*??', '*a', '+', '?', 'a|*',
  '^*', '$+', '\\b*', '\\B{2}', 'a{99999999999}', 'a{2147483648,2147483647}',
  // groups
  '(a)', '(?:a)', '(?=a)', '(?!a)', '(?<=a)', '(?<!a)', '(?=a)*', '(?!a){2}', '(?<=a)*', '(?<!a)+', '(', ')', '(a', 'a)',
  '(?', '(?a)', '(?<a>x)', '(?<a>x)(?<a>y)', '(?<a>x)|(?<a>y)', '((?<a>x)|(?<a>y))(?<a>z)', '(?:(?<a>x)|y)|(?<a>z)',
  '(?<$_é>x)', '(?<1a>x)', '(?<a', '(?<>x)', '(?<a-b>x)', '(?<\\u0061>x)', '(?<\\u{61}>x)', '(?<\\x61>x)',
  '(?<\\ud835\\udc9c>x)', '(?<𝒜>x)', '(?<a\\u200c>x)',
  // modifiers
  '(?i:a)', '(?-i:a)', '(?i-m:a)', '(?ims-:a)', '(?-:a)', '(?ii:a)', '(?i-i:a)', '(?x:a)', '(?i)a', '(?i', '(?i-s',
  // escapes
  '\\', 'a\\', '\\d\\D\\s\\S\\w\\W', '\\f\\n\\r\\t\\v', '\\cA\\cz', '\\c', '\\c1', '\\c_', '\\0', '\\00', '\\012', '\\08',
  '\\1', '(a)\\1', '(a)\\2', '\\1(a)', '(a)\\10', '\\8', '\\9', '\\377', '\\400', '\\x41', '\\x4', '\\xg', '\\u0041',
  '\\u004', '\\u{41}', '\\u{110000}', '\\u{}', '\\ud83d\\ude00', '\\-', '\\/', '\\a', '\\e', '\\q', '\\$', '\\.',
  '\\k', '\\k<a>', '(?<a>x)\\k<a>', '(?<a>x)\\k<b>', '(?<a>x)\\k', '\\k<a>(?<a>x)', '(?<a>x)[\\k]', '[\\k]',
  '\\p{L}', '\\p{Letter}', '\\P{Lu}', '\\p{Script=Latin}', '\\p{sc=Grek}', '\\p{scx=Hira}', '\\p{gc=L}',
  '\\p{General_Category=Lu}', '\\p{ASCII}', '\\p{Any}', '\\p{Latin}', '\\p{Script=Foo}', '\\p{Foo}', '\\p', '\\p{',
  '\\p{L', '\\p{=L}', '\\p{gc=}', '\\p{ASCII=Y}', '\\p{RGI_Emoji}', '\\P{RGI_Emoji}', '\\p{Basic_Emoji}',
  '\\p{Emoji_Keycap_Sequence}', '\\p{Emoji}',
  // classes
  '[]', '[^]', '[abc]', '[^abc]', '[a-z]', '[z-a]', '[a-]', '[-a]', '[a-b-c]', '[--a]', '[\\d-z]', '[a-\\d]',
  '[\\b]', '[\\B]', '[\\-]', '[\\c1]', '[\\c_]', '[\\c]', '[\\c*]', '[\\1]', '[\\8]', '[\\0]', '[\\00]', '[a', '[\\',
  '[😀-😁]', '[\\ud83d\\ude00-\\ud83d\\ude01]', '[\\u{1F600}-\\u{1F601}]', '[\\p{L}]', '[^\\p{L}]', '[\\p{L}-z]',
  '[(){}/|]', '[\\]]', '[]]', '[[]', '[[a]]', '[^[a]]',
  // v flag set operations
  '[a&&b]', '[\\w&&\\d]', '[\\w--\\d]', '[a--b--c]', '[a&&b--c]', '[a-z&&b]', '[a&&]', '[&&a]', '[a&&&b]', '[a&b]',
  '[a--]', '[\\w--[a-z]]', '[[a-z]--[aeiou]]', '[[a-z]&&[^aeiou]]', '[\\q{abc|def}]', '[\\q{}]', '[^\\q{abc}]',
  '[^\\q{a|b}]', '[^\\q{a|bc}]', '[^[\\q{ab}]]', '[^\\p{RGI_Emoji}]', '[\\p{RGI_Emoji}--\\q{x}]', '[^\\p{RGI_Emoji}--a]',
  '[^a--\\p{RGI_Emoji}]', '[^\\p{RGI_Emoji}&&a]', '[\\p{RGI_Emoji}&&\\p{RGI_Emoji}]', '[^\\p{RGI_Emoji}&&\\p{RGI_Emoji}]',
  '[!!]', '[a!!b]', '[^^]', '[^^^]', '[a^^]', '[$$]', '[\\&]', '[\\!]', '[\\~]', '[\\`]', '[\\(]', '[\\q]', '[\\q{a\\|b}]',
  '[\\q{&&}]', '[\\q{\\d}]', '[\\d-a]', '[a-\\q{b}]', '[\\cA]', '[\\x41-\\x5a]', '[\\b-\\n]', '[(]', '[a-z--b]',
  '\\q{a}', '[\\q{a}', '[\\q{a]', '[a&&b',
]

describe('parser validity agrees with the engine', () => {
  for (const flags of MODES) {
    it(`on the corpus (flags "${flags}")`, () => {
      const disagreements = CORPUS.filter((pattern) => parseRegex(pattern, flags).ok !== engineAccepts(pattern, flags))
      expect(disagreements.map((pattern) => `${JSON.stringify(pattern)}: engine ${engineAccepts(pattern, flags) ? 'accepts' : 'rejects'}`)).toEqual([])
    })
  }

  /** Seeded so a failure reproduces; the alphabet is weighted towards syntax. */
  function* fuzz(count: number, seed: number) {
    const alphabet = [
      'a', 'b', 'z', '0', '1', '2', '8', '-', '^', '$', '.', '*', '+', '?', '{', '}', '(', ')', '[', ']', '|', '\\', ',',
      '&', '&&', '--', '(?', '(?<', '(?:', '(?=', '(?<=', '(?i:', '<n>', '\\k<n>', '\\p{L}', '\\q{', '\\u', '\\x',
      '\\c', '{1}', '{2,3}', '😀', '\ud83d', '!', '/', 'k', 'n', '>', '=', '\\d', '\\b',
      '[^', '\\q{ab}', '\\q{a|b}', '\\P{L}', '[[', ']]', '(?<n>a)|(?<n>b)', '\\1', '\\c1', '\\-',
    ]
    let state = seed
    const next = () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff
      return state
    }
    for (let i = 0; i < count; i++) {
      const length = 1 + (next() % 9)
      let pattern = ''
      for (let j = 0; j < length; j++) pattern += alphabet[next() % alphabet.length]
      yield pattern
    }
  }

  for (const flags of MODES) {
    it(`on 6,000 fuzzed patterns (flags "${flags}")`, () => {
      const disagreements: string[] = []
      for (const pattern of fuzz(6000, 7 + flags.length)) {
        if (parseRegex(pattern, flags).ok !== engineAccepts(pattern, flags)) {
          disagreements.push(`${JSON.stringify(pattern)}: engine ${engineAccepts(pattern, flags) ? 'accepts' : 'rejects'}`)
        }
      }
      expect(disagreements.slice(0, 20)).toEqual([])
    })
  }

  it('rejects flags the engine rejects', () => {
    for (const flags of ['gg', 'uv', 'x', 'dgimsuy', 'dgimsvy']) {
      expect(parseRegex('a', flags).ok).toBe(engineAccepts('a', flags))
    }
  })
})

function first(pattern: string, flags = ''): Node {
  const result = parseRegex(pattern, flags)
  if (!result.ok) throw new Error(result.error.message)
  return result.pattern.ast.alternatives[0].items[0]
}

describe('parse trees', () => {
  it('numbers groups by opening parenthesis and records names', () => {
    const result = parseRegex('(a(?<inner>b))(?:c)(d)', '')
    expect(result.ok && result.pattern.groups.map((group) => [group.index, group.name])).toEqual([[1, undefined], [2, 'inner'], [3, undefined]])
  })

  it('reads surrogate pairs as one character only in u/v mode', () => {
    const plain = parseRegex('😀', '')
    expect(plain.ok && plain.pattern.ast.alternatives[0].items).toHaveLength(2)
    expect(first('😀', 'u')).toMatchObject({ type: 'char', value: 0x1f600 })
    expect(first('\\ud83d\\ude00', 'u')).toMatchObject({ type: 'char', value: 0x1f600, start: 0, end: 12 })
  })

  it('tells back-references from Annex B octal escapes', () => {
    expect(first('\\1(a)')).toMatchObject({ type: 'backreference', index: 1 })
    expect(first('\\12')).toMatchObject({ type: 'char', form: 'octal', value: 0o12 })
    expect(first('\\8')).toMatchObject({ type: 'char', form: 'identity', value: 0x38 })
  })

  it('builds quantifiers with bounds and laziness', () => {
    expect(first('a{2,}?')).toMatchObject({ type: 'quantifier', min: 2, max: Infinity, lazy: true })
    expect(first('(?:ab)?')).toMatchObject({ type: 'quantifier', min: 0, max: 1, lazy: false, body: { type: 'group', kind: 'noncapture' } })
  })

  it('parses v-flag set operations and string alternatives', () => {
    expect(first('[\\w--\\d]', 'v')).toMatchObject({ type: 'class', op: 'subtraction', items: [{ kind: 'w' }, { kind: 'd' }] })
    expect(first('[\\q{abc|d}]', 'v')).toMatchObject({ type: 'class', items: [{ type: 'strings', strings: ['abc', 'd'] }] })
    expect(first('\\p{RGI_Emoji}', 'v')).toMatchObject({ type: 'property', strings: true, value: 'RGI_Emoji' })
  })

  it('parses modifiers groups', () => {
    expect(first('(?i-m:a)')).toMatchObject({ type: 'group', kind: 'modifiers', add: 'i', remove: 'm' })
  })

  it('points errors at the offending position', () => {
    const result = parseRegex('ab(cd', '')
    expect(result).toMatchObject({ ok: false, error: { message: 'Unterminated group', index: 2 } })
    expect(parseRegex('a{3,1}', '')).toMatchObject({ ok: false, error: { index: 1 } })
  })

  it('reports deep nesting instead of overflowing the stack', () => {
    const deep = '('.repeat(5000) + ')'.repeat(5000)
    const result = parseRegex(deep, '')
    expect(result.ok).toBe(false)
  })
})

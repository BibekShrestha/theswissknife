import { describe, expect, it } from 'vitest'
import { evaluateJavascript, evaluateTests, MAX_MATCHES } from './javascript'
import type { RegexRequest, TestCase } from './types'

const request = (patch: Partial<RegexRequest> = {}): RegexRequest => ({
  id: 1,
  engines: ['javascript'],
  pattern: '(?<word>foo+)',
  flags: 'giu',
  subject: 'FOO xx fooo',
  operation: 'match',
  replacement: '[$<word>]',
  ...patch,
})

const spans = (patch: Partial<RegexRequest>) => evaluateJavascript(request(patch)).matches.map((m) => [m.start, m.end])

describe('JavaScript regex engine', () => {
  it('normalizes ranges and named captures', () => {
    const result = evaluateJavascript(request())
    expect(result.error).toBeNull()
    expect(result.matches.map((match) => [match.start, match.end, match.text])).toEqual([[0, 3, 'FOO'], [7, 11, 'fooo']])
    expect(result.matches[0].captures[0]).toMatchObject({ index: 1, name: 'word', text: 'FOO', start: 0, end: 3 })
  })

  it('names groups by number even when two share a span or a name', () => {
    const same = evaluateJavascript(request({ pattern: '(?<outer>(?<inner>a))', flags: '', subject: 'a' }))
    expect(same.matches[0].captures.map((c) => c.name)).toEqual(['outer', 'inner'])
    const dup = evaluateJavascript(request({ pattern: '(?<n>a)|(?<n>b)', flags: 'g', subject: 'ab' }))
    expect(dup.matches[1].captures).toMatchObject([{ index: 1, name: 'n', text: null }, { index: 2, name: 'n', text: 'b' }])
  })

  it('supports replacement and invalid-pattern errors', () => {
    expect(evaluateJavascript(request({ operation: 'replace' })).replacement).toBe('[FOO] xx [fooo]')
    expect(evaluateJavascript(request({ pattern: '(' })).error).toBeTruthy()
  })

  it('advances zero-width matches by code point with u and v, by code unit without', () => {
    expect(spans({ pattern: '(?=.)', subject: 'A😀B', flags: 'gu' }).map(([s]) => s)).toEqual([0, 1, 3])
    expect(spans({ pattern: '(?=.)', subject: 'A😀B', flags: 'gv' }).map(([s]) => s)).toEqual([0, 1, 3])
    expect(spans({ pattern: '(?:)', subject: 'A😀', flags: 'g' }).map(([s]) => s)).toEqual([0, 1, 2, 3])
  })

  it('follows y and g lastIndex semantics', () => {
    expect(spans({ pattern: 'a', subject: 'baa', flags: '' })).toEqual([[1, 2]])
    expect(spans({ pattern: 'a', subject: 'baa', flags: 'y' })).toEqual([])
    expect(spans({ pattern: 'a', subject: 'aab', flags: 'y' })).toEqual([[0, 1]])
    expect(spans({ pattern: 'a', subject: 'aaba', flags: 'gy' })).toEqual([[0, 1], [1, 2]])
    expect(spans({ pattern: 'a', subject: 'aaba', flags: 'g' })).toEqual([[0, 1], [1, 2], [3, 4]])
  })

  it('truncates runaway result sets, and only when there are more', () => {
    const over = evaluateJavascript(request({ pattern: '.', subject: 'a'.repeat(MAX_MATCHES + 10), flags: 'g' }))
    expect(over.matches).toHaveLength(MAX_MATCHES)
    expect(over.truncated).toBe(true)
    const exact = evaluateJavascript(request({ pattern: '.', subject: 'a'.repeat(MAX_MATCHES), flags: 'g' }))
    expect(exact.matches).toHaveLength(MAX_MATCHES)
    expect(exact.truncated).toBe(false)
  })

  it('handles a 1 MB subject', () => {
    const subject = 'lorem ipsum dolor\n'.repeat(60_000)
    const result = evaluateJavascript(request({ pattern: 'dolor$', flags: 'gm', subject }))
    expect(result.matches).toHaveLength(MAX_MATCHES)
    expect(result.truncated).toBe(true)
  })
})

describe('test cases', () => {
  const cases = (...list: [string, TestCase['expect'], boolean?][]): TestCase[] => list.map(([text, expect, full]) => ({ text, expect, full: full ?? false }))

  it('passes and fails per case', () => {
    const result = evaluateTests({ pattern: '\\d+', flags: 'g', cases: cases(['a1', 'match'], ['abc', 'no-match'], ['xyz', 'match'], ['42', 'no-match']) })
    expect(result.error).toBeNull()
    expect(result.results.map((r) => r.pass)).toEqual([true, true, false, false])
    expect(result.results[0].match).toEqual({ start: 1, end: 2, text: '1' })
  })

  it('full match needs the whole line, backtracking into alternatives if it must', () => {
    const result = evaluateTests({
      pattern: 'a|ab',
      flags: 'm',
      cases: cases(['ab', 'match', true], ['abc', 'match', true], ['abc', 'no-match', true], ['xab', 'match', true]),
    })
    expect(result.results.map((r) => r.pass)).toEqual([true, false, true, false])
    expect(result.results[1].match?.text).toBe('a')
  })

  it('keeps group numbers for back-references under the full-match wrapper', () => {
    const result = evaluateTests({ pattern: '(\\w)\\1', flags: '', cases: cases(['aa', 'match', true], ['ab', 'no-match', true]) })
    expect(result.results.every((r) => r.pass)).toBe(true)
  })

  it('anchors at the start of the line with y; ignores g and lastIndex between cases', () => {
    const result = evaluateTests({ pattern: 'b', flags: 'gy', cases: cases(['bc', 'match'], ['ab', 'no-match'], ['b', 'match']) })
    expect(result.results.map((r) => r.pass)).toEqual([true, true, true])
  })

  it('reports an invalid pattern once', () => {
    expect(evaluateTests({ pattern: '(', flags: '', cases: cases(['a', 'match']) }).error).toBeTruthy()
  })
})

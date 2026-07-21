import { describe, expect, it } from 'vitest'
import { evaluateJavascript, MAX_MATCHES } from './javascript'
import type { RegexRequest } from './types'

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

describe('JavaScript regex engine', () => {
  it('normalizes ranges and named captures', () => {
    const result = evaluateJavascript(request())
    expect(result.error).toBeNull()
    expect(result.matches.map((match) => [match.start, match.end, match.text])).toEqual([[0, 3, 'FOO'], [7, 11, 'fooo']])
    expect(result.matches[0].captures[0]).toMatchObject({ index: 1, name: 'word', text: 'FOO', start: 0, end: 3 })
  })

  it('supports replacement and invalid-pattern errors', () => {
    expect(evaluateJavascript(request({ operation: 'replace' })).replacement).toBe('[FOO] xx [fooo]')
    expect(evaluateJavascript(request({ pattern: '(' })).error).toBeTruthy()
  })

  it('advances zero-width Unicode matches', () => {
    const result = evaluateJavascript(request({ pattern: '(?=.)', subject: 'A😀B', flags: 'gu' }))
    expect(result.matches.map((match) => match.start)).toEqual([0, 1, 3])
  })

  it('truncates runaway result sets', () => {
    const result = evaluateJavascript(request({ pattern: '.', subject: 'a'.repeat(MAX_MATCHES + 10), flags: 'g' }))
    expect(result.matches).toHaveLength(MAX_MATCHES)
    expect(result.truncated).toBe(true)
  })
})

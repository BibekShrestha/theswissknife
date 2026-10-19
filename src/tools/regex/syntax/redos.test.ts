import { describe, expect, it } from 'vitest'
import { parseRegex } from './parser'
import { analyzeBacktracking, WORK_BUDGET } from './redos'

function analyze(pattern: string, flags = '') {
  const parsed = parseRegex(pattern, flags)
  if (!parsed.ok) throw new Error(parsed.error.message)
  const started = performance.now()
  const result = analyzeBacktracking(pattern, parsed.pattern, flags)
  return { ...result, ms: performance.now() - started }
}

/** n distinct CJK characters as one alternation — none of them overlap. */
const cjk = (n: number) => Array.from({ length: n }, (_, i) => String.fromCodePoint(0x4e00 + i)).join('|')

describe('backtracking analysis stays bounded', () => {
  // A 6.6K-character alternation with gi took 5 s in Node (42 s in a browser)
  // when every pair of alternatives was tested against every sample.
  it('checks a 3,300-alternative alternation with gi in linear work', () => {
    const result = analyze(`(?:${cjk(3300)})+$`, 'gi')
    expect(result.skipped).toBe(false)
    expect(result.risks).toEqual([])
    // ~140 sample tests per alternative, not per pair of alternatives
    expect(result.work).toBeLessThan(3300 * 200)
    expect(result.ms).toBeLessThan(500) // loose: the work bound above is the real guard
  })

  it('still finds the overlap in a large alternation', () => {
    const result = analyze(`(?:${cjk(3000)}|a|A)+$`, 'gi')
    expect(result.skipped).toBe(false)
    expect(result.risks[0].message).toContain('"a" and "A"')
  })

  it('skips, and says so, when the pattern is past the work budget', () => {
    const result = analyze(`(?:${cjk(20_000)})+$`, 'gi')
    expect(result.skipped).toBe(true)
    expect(result.risks).toEqual([])
    expect(result.work).toBeLessThanOrEqual(WORK_BUDGET + 200)
    expect(result.ms).toBeLessThan(500)
  })
})

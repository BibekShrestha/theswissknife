import { describe, expect, it } from 'vitest'
import { computeHighlights, matchAt, rangesIn, snapToCharBoundary, splitsSurrogatePair } from './highlight'
import { evaluateJavascript } from './javascript'

const run = (pattern: string, flags: string, subject: string) =>
  evaluateJavascript({ id: 1, engines: ['javascript'], pattern, flags, subject, operation: 'match', replacement: '' }).matches

const simple = (pattern: string, flags: string, subject: string) =>
  computeHighlights(subject, run(pattern, flags, subject)).map(({ from, to, kind, group, tint, widened }) => ({ from, to, kind, group, tint, widened }))

describe('highlight ranges', () => {
  it('alternates match tints and gives each group number its own', () => {
    expect(simple('(a)(b)', 'g', 'abab')).toEqual([
      { from: 0, to: 2, kind: 'match', group: undefined, tint: 0, widened: false },
      { from: 0, to: 1, kind: 'group', group: 1, tint: 0, widened: false },
      { from: 1, to: 2, kind: 'group', group: 2, tint: 1, widened: false },
      { from: 2, to: 4, kind: 'match', group: undefined, tint: 1, widened: false },
      { from: 2, to: 3, kind: 'group', group: 1, tint: 0, widened: false },
      { from: 3, to: 4, kind: 'group', group: 2, tint: 1, widened: false },
    ])
  })

  it('orders nested groups outer first', () => {
    const ranges = simple('((a)b)', '', 'ab')
    expect(ranges.map((r) => [r.kind, r.group, r.from, r.to])).toEqual([['match', undefined, 0, 2], ['group', 1, 0, 2], ['group', 2, 0, 1]])
  })

  it('marks zero-length matches as empty and skips empty or unmatched groups', () => {
    const ranges = simple('\\b()|(x)', 'g', 'ab')
    expect(ranges).toEqual([
      { from: 0, to: 0, kind: 'empty', group: undefined, tint: 0, widened: false },
      { from: 2, to: 2, kind: 'empty', group: undefined, tint: 1, widened: false },
    ])
  })

  it('keeps UTF-16 indices aligned with u, where surrogate pairs are whole', () => {
    const subject = 'a😀b😀'
    expect(simple('😀', 'gu', subject).map((r) => [r.from, r.to, r.widened])).toEqual([[1, 3, false], [4, 6, false]])
  })

  it('widens ranges that split a surrogate pair without u, and says so', () => {
    const subject = 'x😀'
    // Without u, "." matches single code units: the lead and the trail separately.
    expect(simple('.', 'g', subject).map((r) => [r.from, r.to, r.widened])).toEqual([[0, 1, false], [1, 3, true], [1, 3, true]])
    // An empty match between the halves is drawn at the start of the pair.
    expect(simple('(?:)', 'g', subject).map((r) => [r.from, r.kind, r.widened])).toEqual([[0, 'empty', false], [1, 'empty', false], [1, 'empty', true], [3, 'empty', false]])
  })

  it('snaps and detects pair boundaries', () => {
    const s = 'a😀'
    expect(splitsSurrogatePair(s, 2)).toBe(true)
    expect(splitsSurrogatePair(s, 1)).toBe(false)
    expect(splitsSurrogatePair(s, 3)).toBe(false)
    expect(snapToCharBoundary(s, 2, -1)).toBe(1)
    expect(snapToCharBoundary(s, 2, 1)).toBe(3)
  })

  it('places lookaround captures outside their match', () => {
    const ranges = simple('a(?=(b))', '', 'ab')
    expect(ranges.map((r) => [r.kind, r.from, r.to])).toEqual([['match', 0, 1], ['group', 1, 2]])
  })

  it('finds the match at a position, including empty ones', () => {
    const matches = run('a*', 'g', 'aab')
    expect(matches.map((m) => [m.start, m.end])).toEqual([[0, 2], [2, 2], [3, 3]])
    expect(matchAt(matches, 0)).toBe(0)
    expect(matchAt(matches, 1)).toBe(0)
    expect(matchAt(matches, 2)).toBe(1)
    expect(matchAt(matches, 3)).toBe(2)
    expect(matchAt(run('x', 'g', 'axa'), 0)).toBe(-1)
  })

  it('filters to a visible window', () => {
    const subject = 'ab '.repeat(10_000)
    const ranges = computeHighlights(subject, run('ab', 'g', subject))
    expect(ranges).toHaveLength(1_000)
    expect(rangesIn(ranges, 300, 330).map((r) => r.from)).toEqual([300, 303, 306, 309, 312, 315, 318, 321, 324, 327, 330])
  })
})

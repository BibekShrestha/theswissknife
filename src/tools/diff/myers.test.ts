import { describe, expect, it } from 'vitest'
import { createInterner, diffSequences, type Match } from './myers'

/** Length of the longest common subsequence, by the textbook O(NM) table. */
function lcsLength(a: number[], b: number[]) {
  const row = new Array(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    let diag = 0
    for (let j = 1; j <= b.length; j++) {
      const up = row[j]
      row[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(row[j], row[j - 1])
      diag = up
    }
  }
  return row[b.length]
}

function checkMatches(a: number[], b: number[], matches: Match[]) {
  let ai = 0
  let bi = 0
  for (const m of matches) {
    expect(m.length).toBeGreaterThan(0)
    expect(m.aStart).toBeGreaterThanOrEqual(ai)
    expect(m.bStart).toBeGreaterThanOrEqual(bi)
    for (let i = 0; i < m.length; i++) expect(a[m.aStart + i]).toBe(b[m.bStart + i])
    ai = m.aStart + m.length
    bi = m.bStart + m.length
  }
}

const chars = (s: string) => [...s].map((c) => c.charCodeAt(0))
const total = (matches: Match[]) => matches.reduce((sum, m) => sum + m.length, 0)

describe('diffSequences', () => {
  it('handles empty inputs', () => {
    expect(diffSequences([], [])).toEqual([])
    expect(diffSequences([1, 2], [])).toEqual([])
    expect(diffSequences([], [1, 2])).toEqual([])
  })

  it('returns one run for identical input', () => {
    expect(diffSequences([1, 2, 3], [1, 2, 3])).toEqual([{ aStart: 0, bStart: 0, length: 3 }])
  })

  it('finds the paper example (ABCABBA → CBABAC, D = 5)', () => {
    const a = chars('ABCABBA')
    const b = chars('CBABAC')
    const matches = diffSequences(a, b)
    checkMatches(a, b, matches)
    expect(a.length + b.length - 2 * total(matches)).toBe(5)
  })

  it('is minimal on random inputs', () => {
    let seed = 7
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) >>> 0; return seed % n }
    for (let round = 0; round < 400; round++) {
      const a = Array.from({ length: rand(40) }, () => rand(5))
      const b = rand(2) ? a.map((x) => (rand(4) ? x : rand(5))).filter(() => rand(6) > 0) : Array.from({ length: rand(40) }, () => rand(5))
      const matches = diffSequences(a, b)
      checkMatches(a, b, matches)
      expect(total(matches)).toBe(lcsLength(a, b))
    }
  })

  it('stays fast on a large file with scattered edits', () => {
    const a = Array.from({ length: 200_000 }, (_, i) => i)
    const b = a.filter((x) => x % 997 !== 0).map((x) => (x % 1009 === 0 ? -x : x))
    const started = performance.now()
    const matches = diffSequences(a, b)
    expect(performance.now() - started).toBeLessThan(2000)
    checkMatches(a, b, matches)
  })
})

describe('createInterner', () => {
  it('gives equal strings equal ids', () => {
    const intern = createInterner()
    expect([intern('a'), intern('b'), intern('a')]).toEqual([0, 1, 0])
  })
})

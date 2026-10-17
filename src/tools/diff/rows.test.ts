import { describe, expect, it } from 'vitest'
import { computeDiff, type DiffResult } from './compute'
import { buildRows } from './rows'

const lines = (n: number, edit?: number) => Array.from({ length: n }, (_, i) => (i === edit ? 'changed' : `line ${i}`)).join('\n') + '\n'
const diff = (a: string, b: string) => computeDiff(a, b, { mode: 'text', ignoreWhitespace: false, ignoreCase: false }) as DiffResult

describe('buildRows', () => {
  it('folds long unchanged runs around a change', () => {
    const rows = buildRows(diff(lines(100), lines(100, 50)), 3, new Set(), 'split')
    expect(rows.map((r) => r.kind)).toEqual(['fold', 'equal', 'equal', 'equal', 'change', 'equal', 'equal', 'equal', 'fold'])
    expect(rows[0]).toEqual({ kind: 'fold', id: 0, count: 47 })
    expect(rows[8]).toEqual({ kind: 'fold', id: 2, count: 46 })
  })

  it('expands a fold on request', () => {
    expect(buildRows(diff(lines(100), lines(100, 50)), 3, new Set([0, 2]), 'split')).toHaveLength(100)
  })

  it('does not fold a run that would hide a single line', () => {
    expect(buildRows(diff(lines(8), lines(8, 4)), 3, new Set(), 'split').some((r) => r.kind === 'fold')).toBe(false)
  })

  it('pairs a replacement in split view and stacks it in unified view', () => {
    const result = diff('a\nb\n', 'a\nx\ny\n')
    expect(buildRows(result, 3, new Set(), 'split').slice(1)).toEqual([{ kind: 'change', a: 1, b: 1 }, { kind: 'change', a: null, b: 2 }])
    expect(buildRows(result, 3, new Set(), 'unified').slice(1)).toEqual([{ kind: 'change', a: 1, b: null }, { kind: 'change', a: null, b: 1 }, { kind: 'change', a: null, b: 2 }])
  })
})

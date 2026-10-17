import type { DiffResult } from './compute'

/** Line indexes are 0-based; `null` is an empty cell opposite an insertion or deletion. */
export type Row =
  | { kind: 'equal'; a: number; b: number }
  | { kind: 'change'; a: number | null; b: number | null }
  | { kind: 'fold'; id: number; count: number }

/**
 * Lays the diff out as rows. Unchanged runs longer than 2 × context collapse
 * into a fold row unless their id is in `expanded`; a changed block pairs its
 * removed and added lines side by side (`split`) or lists removals first
 * (`unified`).
 */
export function buildRows(result: DiffResult, context: number, expanded: ReadonlySet<number>, layout: 'split' | 'unified'): Row[] {
  const rows: Row[] = []
  const last = result.blocks.length - 1
  result.blocks.forEach((block, index) => {
    if (block.type === 'equal') {
      const length = block.aEnd - block.aStart
      const head = index === 0 ? 0 : context
      const tail = index === last ? 0 : context
      const equal = (i: number) => rows.push({ kind: 'equal', a: block.aStart + i, b: block.bStart + i })
      if (expanded.has(index) || length <= head + tail + 1) {
        for (let i = 0; i < length; i++) equal(i)
        return
      }
      for (let i = 0; i < head; i++) equal(i)
      rows.push({ kind: 'fold', id: index, count: length - head - tail })
      for (let i = length - tail; i < length; i++) equal(i)
      return
    }
    const removed = block.aEnd - block.aStart
    const added = block.bEnd - block.bStart
    if (layout === 'split') {
      for (let i = 0; i < Math.max(removed, added); i++) {
        rows.push({ kind: 'change', a: i < removed ? block.aStart + i : null, b: i < added ? block.bStart + i : null })
      }
    } else {
      for (let i = 0; i < removed; i++) rows.push({ kind: 'change', a: block.aStart + i, b: null })
      for (let i = 0; i < added; i++) rows.push({ kind: 'change', a: null, b: block.bStart + i })
    }
  })
  return rows
}

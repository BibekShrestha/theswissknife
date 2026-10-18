import { PdfInputError } from './errors'

/**
 * Parses one page-range group such as "1-3", "5", "7-" (to the end),
 * "-4" (from the start) or "9-6" (descending) into 0-based indices.
 * Ranges are checked against the page count *before* anything is
 * allocated, so "1-999999999" is an error message rather than a frozen tab.
 */
function parseGroup(part: string, total: number): number[] {
  const m = /^(\d*)\s*[-–]\s*(\d*)$/.exec(part)
  if (!m && !/^\d+$/.test(part)) throw new PdfInputError(`“${part}” is not a page number or range (like 3 or 2-5).`)
  const from = m ? (m[1] ? Number(m[1]) : 1) : Number(part)
  const to = m ? (m[2] ? Number(m[2]) : total) : from
  if (m && !m[1] && !m[2]) throw new PdfInputError('“-” needs a page on at least one side.')
  for (const n of [from, to]) {
    if (n < 1 || n > total) {
      throw new PdfInputError(`Page ${n} is out of range — this PDF has ${total} page${total === 1 ? '' : 's'}.`)
    }
  }
  const step = to >= from ? 1 : -1
  return Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => from - 1 + i * step)
}

/** Comma-separated groups, each kept separate (Split makes one file per group). */
export function parsePageGroups(input: string, total: number): number[][] {
  const parts = input.split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length === 0) throw new PdfInputError('Enter at least one page or range.')
  return parts.map((part) => parseGroup(part, total))
}

/** Comma-separated groups flattened in order, e.g. "1-3,5,7-" → [0,1,2,4,6,…]. */
export function parsePageList(input: string, total: number): number[] {
  return parsePageGroups(input, total).flat()
}

/** "1, 3–5, 9" for a sorted list of 0-based indices. */
export function describePages(indices: number[]): string {
  const runs: string[] = []
  for (let i = 0; i < indices.length; i++) {
    let j = i
    while (j + 1 < indices.length && indices[j + 1] === indices[j] + 1) j++
    runs.push(i === j ? `${indices[i] + 1}` : `${indices[i] + 1}–${indices[j] + 1}`)
    i = j
  }
  return runs.join(', ')
}

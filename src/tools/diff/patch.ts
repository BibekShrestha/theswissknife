import type { DiffResult } from './compute'

export interface Hunk {
  aStart: number
  aEnd: number
  bStart: number
  bEnd: number
}

/**
 * Groups changes into hunks with `context` unchanged lines around each, merging
 * changes whose context would touch — the same grouping as `diff -u`.
 */
export function hunks(result: DiffResult, context: number): Hunk[] {
  const out: Hunk[] = []
  for (const block of result.blocks) {
    if (block.type !== 'change') continue
    const aStart = Math.max(0, block.aStart - context)
    const bStart = Math.max(0, block.bStart - context)
    const aEnd = Math.min(result.a.lines.length, block.aEnd + context)
    const bEnd = Math.min(result.b.lines.length, block.bEnd + context)
    const last = out[out.length - 1]
    if (last && aStart <= last.aEnd) {
      last.aEnd = aEnd
      last.bEnd = bEnd
    } else out.push({ aStart, aEnd, bStart, bEnd })
  }
  return out
}

/** Renders a unified diff that `patch` and `git apply` accept. */
export function unifiedPatch(result: DiffResult, labelA: string, labelB: string, context = 3): string {
  const { a, b } = result
  if (!result.blocks.some((block) => block.type === 'change')) return ''
  const lines = [`--- ${labelA}`, `+++ ${labelB}`]
  const range = (start: number, end: number) => {
    const count = end - start
    // An empty range names the line before it, as diff -u does.
    return count === 1 ? `${start + 1}` : `${count ? start + 1 : start},${count}`
  }
  const emit = (prefix: string, text: string, isLastOf: boolean) => {
    lines.push(prefix + text)
    if (isLastOf) lines.push('\\ No newline at end of file')
  }

  for (const hunk of hunks(result, context)) {
    lines.push(`@@ -${range(hunk.aStart, hunk.aEnd)} +${range(hunk.bStart, hunk.bEnd)} @@`)
    for (const block of result.blocks) {
      if (block.aEnd <= hunk.aStart && block.bEnd <= hunk.bStart) continue
      if (block.aStart >= hunk.aEnd && block.bStart >= hunk.bEnd) break
      if (block.type === 'equal') {
        const from = Math.max(block.aStart, hunk.aStart)
        const to = Math.min(block.aEnd, hunk.aEnd)
        for (let i = from; i < to; i++) emit(' ', a.lines[i], a.noEol && i === a.lines.length - 1)
      } else {
        for (let i = block.aStart; i < block.aEnd; i++) emit('-', a.lines[i], a.noEol && i === a.lines.length - 1)
        for (let i = block.bStart; i < block.bEnd; i++) emit('+', b.lines[i], b.noEol && i === b.lines.length - 1)
      }
    }
  }
  return lines.join('\n') + '\n'
}

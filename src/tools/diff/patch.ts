import type { DiffResult, PatchView } from './compute'

export interface Hunk {
  aStart: number
  aEnd: number
  bStart: number
  bEnd: number
  /** The blocks the hunk touches, firstBlock..lastBlock inclusive. */
  firstBlock: number
  lastBlock: number
}

/**
 * Groups changes into hunks with `context` unchanged lines around each, merging
 * changes whose context would touch — the same grouping as `diff -u`.
 */
export function hunks(view: PatchView, context: number): Hunk[] {
  const out: Hunk[] = []
  view.blocks.forEach((block, index) => {
    if (block.type !== 'change') return
    const aStart = Math.max(0, block.aStart - context)
    const bStart = Math.max(0, block.bStart - context)
    const aEnd = Math.min(view.a.lines.length, block.aEnd + context)
    const bEnd = Math.min(view.b.lines.length, block.bEnd + context)
    const last = out[out.length - 1]
    if (last && aStart <= last.aEnd) {
      last.aEnd = aEnd
      last.bEnd = bEnd
      last.lastBlock = index
    } else {
      out.push({ aStart, aEnd, bStart, bEnd, firstBlock: Math.max(0, index - 1), lastBlock: index })
    }
  })
  // trailing context comes from the equal block after the last change
  for (const hunk of out) if (hunk.lastBlock + 1 < view.blocks.length) hunk.lastBlock++
  return out
}

/**
 * Labels for the --- and +++ lines. Both name the original file, with the
 * a/ and b/ prefixes git writes, so `patch -p1` and `git apply` patch that
 * one file — two different bare names (the defaults are "original" and
 * "changed") left git apply looking for a file that does not exist.
 */
export function patchLabels(nameA: string, _nameB: string): [string, string] {
  const name = nameA.replace(/[\t\r\n]/g, ' ') || 'file'
  return [`a/${name}`, `b/${name}`]
}

/**
 * Renders a unified diff that `patch` and `git apply` accept, from the
 * result's patch view: lines split on LF only, so each one is written with
 * the bytes it had — a CRLF line keeps its CR, a CR-only file is one line, and
 * a change that only touches line endings is a change. Empty in JSON mode,
 * where the compared text is the re-printed documents rather than either
 * input. Linear in the number of blocks: each hunk walks only its own.
 */
export function unifiedPatch(result: DiffResult, labelA: string, labelB: string, context = 3): string {
  const view = result.patch
  if (!view || !view.blocks.some((block) => block.type === 'change')) return ''
  const { a, b } = view
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

  for (const hunk of hunks(view, context)) {
    lines.push(`@@ -${range(hunk.aStart, hunk.aEnd)} +${range(hunk.bStart, hunk.bEnd)} @@`)
    for (let index = hunk.firstBlock; index <= hunk.lastBlock; index++) {
      const block = view.blocks[index]
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

/** Whether there is anything to export, without building the patch. */
export function hasPatch(result: DiffResult): boolean {
  return !!result.patch?.blocks.some((block) => block.type === 'change')
}

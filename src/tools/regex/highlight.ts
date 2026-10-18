/**
 * Match and group ranges for the subject editor, in UTF-16 code units — the
 * unit both RegExp indices and CodeMirror positions use, so no conversion is
 * needed for u/v patterns. Without u or v a match can begin or end between the
 * two halves of a surrogate pair (`.` matches one half of an emoji); drawing
 * that boundary would split the glyph, so the drawn range is widened to the
 * whole pair and the range is flagged so the tooltip can say why.
 */

import type { MatchSpan } from './types'

export const GROUP_TINTS = 6

export interface HighlightRange {
  from: number
  to: number
  kind: 'match' | 'group' | 'empty'
  /** Index into the match list. */
  match: number
  /** Capture number, for group ranges. */
  group?: number
  /** 0/1 alternating per match; 0..GROUP_TINTS-1 per group number. */
  tint: number
  /** The real range split a surrogate pair and was widened to draw it. */
  widened: boolean
}

const isLead = (code: number) => code >= 0xd800 && code <= 0xdbff
const isTrail = (code: number) => code >= 0xdc00 && code <= 0xdfff

/** Whether `index` falls between the halves of a surrogate pair. */
export function splitsSurrogatePair(subject: string, index: number): boolean {
  return index > 0 && index < subject.length && isLead(subject.charCodeAt(index - 1)) && isTrail(subject.charCodeAt(index))
}

/** Moves a mid-pair index to the pair's start (`side` -1) or end (+1). */
export function snapToCharBoundary(subject: string, index: number, side: -1 | 1): number {
  return splitsSurrogatePair(subject, index) ? index + (side < 0 ? -1 : 1) : index
}

function span(subject: string, start: number, end: number) {
  const from = snapToCharBoundary(subject, start, -1)
  const to = start === end ? from : snapToCharBoundary(subject, end, 1)
  return { from, to, widened: from !== start || to !== end }
}

/**
 * Ranges sorted by `from`, matches before the groups inside them, outer
 * groups before inner ones — the order CodeMirror needs to nest marks.
 */
export function computeHighlights(subject: string, matches: MatchSpan[]): HighlightRange[] {
  const ranges: HighlightRange[] = []
  matches.forEach((m, index) => {
    const outer = span(subject, m.start, m.end)
    ranges.push({ ...outer, kind: m.start === m.end ? 'empty' : 'match', match: index, tint: index % 2 })
    for (const capture of m.captures) {
      if (capture.start === null || capture.end === null || capture.start === capture.end) continue
      ranges.push({
        ...span(subject, capture.start, capture.end),
        kind: 'group',
        match: index,
        group: capture.index,
        tint: (capture.index - 1) % GROUP_TINTS,
      })
    }
  })
  const order = { match: 0, empty: 0, group: 1 }
  return ranges.sort((a, b) => a.from - b.from || order[a.kind] - order[b.kind] || b.to - a.to || (a.group ?? 0) - (b.group ?? 0))
}

/** Ranges that touch [from, to] — what the editor decorates for the visible part. */
export function rangesIn(ranges: HighlightRange[], from: number, to: number): HighlightRange[] {
  return ranges.filter((range) => range.to >= from && range.from <= to)
}

/**
 * The match at a position: one that contains it, or an empty match exactly
 * there. Matches come from exec in order, so their starts never decrease.
 */
export function matchAt(matches: MatchSpan[], pos: number): number {
  let lo = 0
  let hi = matches.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (matches[mid].start <= pos) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  // Walk back over empty matches at the same start and earlier matches that still reach pos.
  for (let i = found; i >= 0 && i >= found - 2; i--) {
    const m = matches[i]
    if ((m.start <= pos && pos < m.end) || (m.start === m.end && m.start === pos)) return i
  }
  return -1
}

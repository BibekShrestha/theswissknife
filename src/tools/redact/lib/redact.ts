/**
 * Replace characters with one mask character, keeping the shape of the text.
 * One character in, one character out, nothing kept — so unlike a black
 * rectangle drawn over a PDF, there is no layer underneath to recover.
 *
 * Redaction works over ranges, so the whole text and a handful of picked spans
 * are the same operation with a different list of ranges.
 *
 * The shape is the point and also the risk: word lengths are a strong hint at
 * the words. `leaks()` spells out what the current settings still give away,
 * and the UI shows it, because a redaction tool that oversells itself is worse
 * than no tool at all.
 */

import { DEFAULT_MASK } from './characters'

export type SpaceMode = 'keep' | 'remove' | 'redact'

export interface RedactOptions {
  /** The mask character. Anything longer than one grapheme is trimmed to it. */
  mask: string
  spaces: SpaceMode
}

export const DEFAULT_OPTIONS: RedactOptions = { mask: DEFAULT_MASK, spaces: 'keep' }

/** Half-open interval of UTF-16 offsets into the source text. */
export interface Range {
  start: number
  end: number
}

/** Something to look for: typed text, a selection, or a pattern. */
export interface Target {
  kind: 'literal' | 'regex'
  value: string
}

/**
 * Splits text the way a reader sees it: one emoji is one character, even when
 * it is a seven-code-point family, and a letter plus its combining accent is
 * one too. Masking per code unit would leak how exotic a character was.
 */
const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

export function graphemes(text: string): string[] {
  if (!text) return []
  if (segmenter) return Array.from(segmenter.segment(text), (part) => part.segment)
  return [...text] // code points: still better than UTF-16 units
}

const LINE_SPLIT = /(\r\n|\n|\r)/
const LINE_BREAK = /^(?:\r\n|[\n\r\u2028\u2029])$/
const WHITESPACE = /^\s$/u

/** First grapheme of the requested mask, or the default when there is none. */
export function normalizeMask(mask: string): string {
  const first = graphemes(mask)[0]
  if (!first || WHITESPACE.test(first)) return DEFAULT_MASK
  return first
}

/** Masks the whole text. */
export function redact(text: string, options: RedactOptions): string {
  return redactRanges(text, [{ start: 0, end: text.length }], options)
}

/**
 * Masks only the graphemes covered by `ranges`; everything else passes through
 * untouched. A range that lands mid-grapheme masks the whole grapheme, so a
 * match can never split an emoji in half.
 */
export function redactRanges(text: string, ranges: Range[], options: RedactOptions): string {
  const merged = mergeRanges(ranges)
  if (merged.length === 0 || !text) return text
  const mask = normalizeMask(options.mask)

  let out = ''
  let offset = 0
  let next = 0 // ranges and graphemes both run left to right, so one pointer does
  for (const grapheme of graphemes(text)) {
    const end = offset + grapheme.length
    while (next < merged.length && merged[next].end <= offset) next++
    const covered = next < merged.length && merged[next].start < end
    out += covered ? maskGrapheme(grapheme, mask, options.spaces) : grapheme
    offset = end
  }
  return out
}

function maskGrapheme(grapheme: string, mask: string, spaces: SpaceMode): string {
  // line structure always survives, whatever the space setting says
  if (LINE_BREAK.test(grapheme)) return grapheme
  if (WHITESPACE.test(grapheme)) {
    if (spaces === 'keep') return grapheme // the original tab or NBSP, not a space
    return spaces === 'redact' ? mask : ''
  }
  return mask
}

/** Sorts and flattens overlapping or touching ranges. */
export function mergeRanges(ranges: Range[]): Range[] {
  const clean = ranges
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: Range[] = []
  for (const range of clean) {
    const last = merged[merged.length - 1]
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end)
    else merged.push({ ...range })
  }
  return merged
}

export interface MatchReport {
  ranges: Range[]
  /** Match count per target, in the order given. */
  counts: number[]
  /** Why a target could not be used, per target — an invalid pattern. */
  errors: (string | null)[]
  /** True when MAX_MATCHES cut the search short. */
  truncated: boolean
}

/** A pathological pattern should stop somewhere rather than eat the tab. */
export const MAX_MATCHES = 20_000

export function findRanges(
  text: string,
  targets: Target[],
  options: { caseSensitive?: boolean } = {},
): MatchReport {
  const ranges: Range[] = []
  const counts: number[] = []
  const errors: (string | null)[] = []
  let truncated = false

  for (const target of targets) {
    if (!target.value) {
      counts.push(0)
      errors.push(null)
      continue
    }
    // No unicode flag: it rejects escapes people reasonably write, such as
    // [\w\-], and offsets do not need it — masking is grapheme-aligned anyway.
    const flags = options.caseSensitive ? 'g' : 'gi'
    let pattern: RegExp
    try {
      pattern = new RegExp(target.kind === 'regex' ? target.value : escapeLiteral(target.value), flags)
    } catch (error) {
      counts.push(0)
      errors.push(error instanceof Error ? error.message : String(error))
      continue
    }

    let count = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      if (match[0].length === 0) {
        pattern.lastIndex++ // a zero-width match would spin here forever
        continue
      }
      ranges.push({ start: match.index, end: match.index + match[0].length })
      count++
      if (ranges.length >= MAX_MATCHES) {
        truncated = true
        break
      }
    }
    counts.push(count)
    errors.push(null)
    if (truncated) break
  }

  return { ranges: mergeRanges(ranges), counts, errors, truncated }
}

function escapeLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface Measurements {
  /** Characters that would be masked, counted as a reader sees them. */
  masked: number
  /** Whitespace characters inside lines. */
  spaces: number
  words: number
  lines: number
}

export function measure(text: string): Measurements {
  const lines = text.split(LINE_SPLIT).filter((_, i) => i % 2 === 0)
  let masked = 0
  let spaces = 0
  let words = 0
  for (const line of lines) {
    let inWord = false
    for (const grapheme of graphemes(line)) {
      if (WHITESPACE.test(grapheme)) {
        spaces++
        inWord = false
      } else {
        masked++
        if (!inWord) {
          words++
          inWord = true
        }
      }
    }
  }
  return { masked, spaces, words, lines: lines.length }
}

/**
 * What the output still tells a reader. Ordered most-revealing first, so the UI
 * can lead with the thing worth worrying about.
 */
export function leaks(text: string, options: RedactOptions, partial = false): string[] {
  const { words, lines } = measure(text)
  const notes: string[] = []

  if (partial) notes.push('everything you did not pick, exactly as you wrote it')

  if (options.spaces === 'keep') {
    notes.push(
      partial
        ? "each masked span's word lengths, which can be enough to guess short values"
        : `every word's length — ${words} word${words === 1 ? '' : 's'} of known size, which is often enough to guess short text`,
    )
    if (!partial && /^[ \t]+/m.test(text)) notes.push('leading indentation')
  } else if (options.spaces === 'redact') {
    notes.push(partial ? "each masked span's exact length" : "each line's exact character count, spaces included")
  } else {
    notes.push(
      partial
        ? "each masked span's length, spaces excluded"
        : "each line's character count, spaces excluded",
    )
  }

  if (!partial && lines > 1) notes.push(`the line structure — ${lines} lines, blank ones included`)
  return notes
}

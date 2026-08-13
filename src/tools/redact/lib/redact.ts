/**
 * Replace every character with one mask character, keeping the shape of the
 * text. One character in, one character out, nothing kept — so unlike a black
 * rectangle drawn over a PDF, there is no layer underneath to recover.
 *
 * The shape is the point and also the risk: word lengths are a strong hint at
 * the words. `leaks()` spells out what each setting still gives away, and the
 * UI shows it, because a redaction tool that oversells itself is worse than no
 * tool at all.
 */

import { DEFAULT_MASK } from './characters'

export type SpaceMode = 'keep' | 'remove' | 'redact'

export interface RedactOptions {
  /** The mask character. Anything longer than one grapheme is trimmed to it. */
  mask: string
  spaces: SpaceMode
}

export const DEFAULT_OPTIONS: RedactOptions = { mask: DEFAULT_MASK, spaces: 'keep' }

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

/** Line breaks survive redaction, so they are split out and put back verbatim. */
const LINE_SPLIT = /(\r\n|\n|\r)/

const WHITESPACE = /^\s$/u

/** First grapheme of the requested mask, or the default when there is none. */
export function normalizeMask(mask: string): string {
  const first = graphemes(mask)[0]
  if (!first || WHITESPACE.test(first)) return DEFAULT_MASK
  return first
}

export function redact(text: string, options: RedactOptions): string {
  const mask = normalizeMask(options.mask)
  // splitting on a capturing group alternates line, separator, line, … so odd
  // indices are the line breaks and pass through untouched
  return text
    .split(LINE_SPLIT)
    .map((part, i) => (i % 2 === 1 ? part : redactLine(part, mask, options.spaces)))
    .join('')
}

function redactLine(line: string, mask: string, spaces: SpaceMode): string {
  let out = ''
  for (const grapheme of graphemes(line)) {
    if (WHITESPACE.test(grapheme)) {
      // keep the original whitespace so tabs and non-breaking spaces survive
      if (spaces === 'keep') out += grapheme
      else if (spaces === 'redact') out += mask
      // 'remove' drops it entirely
    } else {
      out += mask
    }
  }
  return out
}

export interface Measurements {
  /** Characters that were masked, counted as a reader sees them. */
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
export function leaks(text: string, options: RedactOptions): string[] {
  const { words, lines } = measure(text)
  const notes: string[] = []

  if (options.spaces === 'keep') {
    notes.push(
      `every word's length — ${words} word${words === 1 ? '' : 's'} of known size, which is often enough to guess short text`,
    )
    if (/^[ \t]+/m.test(text)) notes.push('leading indentation')
  } else if (options.spaces === 'redact') {
    notes.push("each line's exact character count, spaces included")
  } else {
    notes.push("each line's character count, spaces excluded")
  }

  if (lines > 1) notes.push(`the line structure — ${lines} lines, blank ones included`)
  return notes
}

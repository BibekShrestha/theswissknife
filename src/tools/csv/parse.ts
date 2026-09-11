/**
 * An RFC 4180 parser, written by hand rather than pulled in as a dependency:
 * a tool folder here has to stay self-contained, and the interesting part of a
 * CSV viewer is not the happy path but what it says about the rows it could
 * not read. Nothing is silently dropped — ragged rows and unterminated quotes
 * come back as issues the UI shows.
 */

export const DELIMITERS = [',', ';', '\t', '|'] as const

export const DELIMITER_LABELS: Record<string, string> = {
  ',': 'comma',
  ';': 'semicolon',
  '\t': 'tab',
  '|': 'pipe',
}

export interface ParseOptions {
  delimiter: string
  /** Quote character, or '' to treat quotes as ordinary text. */
  quote: string
  /** Lines starting with this are skipped, or '' to keep every line. */
  comment: string
  skipEmptyLines: boolean
  trim: boolean
}

export interface ParseIssue {
  /** Index into `rows`. */
  row: number
  kind: 'ragged' | 'unterminated-quote'
  detail: string
}

export interface ParseResult {
  rows: string[][]
  /** Widest row — ragged overflow stays visible instead of being cut off. */
  width: number
  issues: ParseIssue[]
  /** Total ragged rows, which can exceed the issues actually listed. */
  raggedRows: number
}

export const DEFAULT_OPTIONS: ParseOptions = {
  delimiter: ',',
  quote: '"',
  comment: '',
  skipEmptyLines: true,
  trim: false,
}

/** Listing every ragged row in a broken million-row file helps nobody. */
const MAX_ISSUES = 40

const LF = 10
const CR = 13

/** Scans to the next delimiter or line break, whichever comes first. */
function fieldEnd(text: string, from: number, delimiter: number, len: number): number {
  let i = from
  while (i < len) {
    const code = text.charCodeAt(i)
    if (code === delimiter || code === LF || code === CR) break
    i++
  }
  return i
}

export function parseCsv(text: string, options: ParseOptions): ParseResult {
  const { delimiter, quote, comment, skipEmptyLines, trim } = options
  const delimiterCode = delimiter.charCodeAt(0)
  const quoteCode = quote ? quote.charCodeAt(0) : -1
  const len = text.length

  const rows: string[][] = []
  const issues: ParseIssue[] = []
  let row: string[] = []
  let width = 0
  let i = 0

  const endRow = () => {
    // A blank line parses as a single empty field; that is what "empty" means.
    if (!(skipEmptyLines && row.length === 1 && row[0] === '')) {
      rows.push(row)
      if (row.length > width) width = row.length
    }
    row = []
  }

  while (i < len) {
    // Comments are only recognised at the very start of a row, so a '#' inside
    // a field cannot swallow the rest of the line.
    if (comment && row.length === 0 && text.startsWith(comment, i)) {
      const stop = fieldEnd(text, i, -1, len)
      i = stop < len && text.charCodeAt(stop) === CR && text.charCodeAt(stop + 1) === LF ? stop + 2 : stop + 1
      continue
    }

    let value: string
    if (quoteCode >= 0 && text.charCodeAt(i) === quoteCode) {
      i++
      let out = ''
      let start = i
      for (;;) {
        const close = text.indexOf(quote, i)
        if (close === -1) {
          out += text.slice(start)
          issues.push({
            row: rows.length,
            kind: 'unterminated-quote',
            detail: 'the quote is never closed, so the rest of the file became one field',
          })
          i = len
          break
        }
        if (text.charCodeAt(close + 1) === quoteCode) {
          // "" inside a quoted field is one literal quote.
          out += text.slice(start, close + 1)
          i = close + 2
          start = i
          continue
        }
        out += text.slice(start, close)
        i = close + 1
        break
      }
      // Text after the closing quote but before the delimiter is malformed
      // ("a"b,c). Keeping it beats dropping characters the file really has.
      const stop = fieldEnd(text, i, delimiterCode, len)
      value = stop > i ? out + text.slice(i, stop) : out
      i = stop
    } else {
      const stop = fieldEnd(text, i, delimiterCode, len)
      value = text.slice(i, stop)
      i = stop
    }

    row.push(trim ? value.trim() : value)

    if (i >= len) {
      endRow()
      break
    }
    const code = text.charCodeAt(i)
    if (code === delimiterCode) {
      i++
      // A line ending in a delimiter still has one more (empty) field.
      if (i >= len) {
        row.push('')
        endRow()
      }
      continue
    }
    i += code === CR && text.charCodeAt(i + 1) === LF ? 2 : 1
    endRow()
  }

  // Ragged rows are measured against the first row, because that is the one
  // the reader is treating as the header.
  const expected = rows[0]?.length ?? 0
  let raggedRows = 0
  for (let r = 1; r < rows.length; r++) {
    if (rows[r].length === expected) continue
    raggedRows++
    if (issues.length < MAX_ISSUES) {
      issues.push({
        row: r,
        kind: 'ragged',
        detail: `${rows[r].length} field${rows[r].length === 1 ? '' : 's'}, expected ${expected}`,
      })
    }
  }

  return { rows, width, issues, raggedRows }
}

export interface Detection {
  delimiter: string
  /** Other delimiters that split the sample just as consistently. */
  alternatives: string[]
  /** False when nothing split the sample into more than one column. */
  found: boolean
}

const SAMPLE_BYTES = 64 * 1024
const SAMPLE_ROWS = 60

function modeOf(counts: number[]): number {
  const tally = new Map<number, number>()
  let best = 0
  let bestCount = 0
  for (const count of counts) {
    const next = (tally.get(count) ?? 0) + 1
    tally.set(count, next)
    if (next > bestCount || (next === bestCount && count > best)) {
      best = count
      bestCount = next
    }
  }
  return best
}

/**
 * Picks the delimiter that splits the sample most *consistently* — frequency
 * alone picks the comma out of European decimals every time. Ties are reported
 * rather than hidden, since a genuinely ambiguous file is one the reader has
 * to settle, and the toolbar lets them.
 */
export function detectDelimiter(text: string, quote = '"'): Detection {
  const sample = text.slice(0, SAMPLE_BYTES)
  const clipped = sample.length < text.length

  const scored = DELIMITERS.map((delimiter) => {
    const { rows } = parseCsv(sample, { ...DEFAULT_OPTIONS, delimiter, quote })
    let lines = rows.slice(0, SAMPLE_ROWS)
    // A 64 KB cut usually lands mid-row; that row would look ragged.
    if (clipped && rows.length <= SAMPLE_ROWS && lines.length > 1) lines = lines.slice(0, -1)
    if (lines.length === 0) return { delimiter, agree: 0, columns: 0 }
    const counts = lines.map((line) => line.length)
    const columns = modeOf(counts)
    const agree = counts.filter((count) => count === columns).length / counts.length
    return { delimiter, agree, columns }
  }).filter((candidate) => candidate.columns > 1)

  if (scored.length === 0) return { delimiter: ',', alternatives: [], found: false }

  // Rounded, so a single odd row does not decide between two good candidates;
  // then the wider split, then the order delimiters are conventionally tried.
  const rank = (candidate: (typeof scored)[number]) => Math.round(candidate.agree * 20)
  scored.sort((a, b) => rank(b) - rank(a) || b.columns - a.columns)

  const [winner] = scored
  const alternatives = scored
    .slice(1)
    .filter((candidate) => rank(candidate) === rank(winner))
    .map((candidate) => candidate.delimiter)

  return { delimiter: winner.delimiter, alternatives, found: true }
}

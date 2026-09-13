/**
 * Everything between "rows parsed" and "rows on screen": column typing,
 * sorting, searching and initial column widths. Kept pure so the grid can stay
 * about painting, and so the fiddly parts (numeric vs lexical order, empties)
 * are testable without a DOM.
 */

export type ColumnType = 'number' | 'date' | 'boolean' | 'text'

export type SortDirection = 'asc' | 'desc'

export interface Sort {
  column: number
  direction: SortDirection
}

/** Plain, grouped and signed decimals, plus exponents. Not currency. */
const NUMBER = /^[+-]?(\d+|\d{1,3}(,\d{3})+)(\.\d+)?([eE][+-]?\d+)?$/
const BOOLEAN = /^(true|false|yes|no|y|n|t|f|0|1)$/i
/** ISO-ish dates only — Date.parse guesses far too eagerly to trust for this. */
const DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

export function parseNumber(value: string): number | null {
  const text = value.trim()
  if (!text || !NUMBER.test(text)) return null
  const parsed = Number(text.replace(/,/g, ''))
  return Number.isNaN(parsed) ? null : parsed
}

export function parseDate(value: string): number | null {
  const text = value.trim()
  if (!DATE.test(text)) return null
  const time = Date.parse(text)
  return Number.isNaN(time) ? null : time
}

const SAMPLE = 200

/**
 * Types a column from its non-empty values. Every sampled value has to agree —
 * one stray "n/a" in a price column makes it text, which is the honest answer:
 * sorting it as a number would silently reorder the rows around it.
 */
export function inferType(values: Iterable<string>): ColumnType {
  let seen = 0
  let numbers = 0
  let dates = 0
  let booleans = 0
  for (const value of values) {
    if (!value || !value.trim()) continue
    seen++
    if (parseNumber(value) !== null) numbers++
    if (parseDate(value) !== null) dates++
    if (BOOLEAN.test(value.trim())) booleans++
    if (seen >= SAMPLE) break
  }
  if (seen === 0) return 'text'
  if (dates === seen) return 'date'
  if (numbers === seen) return 'number'
  // 0/1 columns are numbers first — that is how people sort and sum them.
  if (booleans === seen && numbers < seen) return 'boolean'
  return 'text'
}

export function columnTypes(rows: string[][], width: number, start: number): ColumnType[] {
  const types: ColumnType[] = []
  for (let column = 0; column < width; column++) {
    types.push(
      inferType(
        (function* () {
          for (let r = start; r < rows.length; r++) yield rows[r][column] ?? ''
        })(),
      ),
    )
  }
  return types
}

const BOOL_ORDER: Record<string, number> = {
  false: 0, f: 0, n: 0, no: 0, '0': 0,
  true: 1, t: 1, y: 1, yes: 1, '1': 1,
}

export const isBlank = (value: string) => value.trim() === ''

/** Empty cells sort last in both directions — they are absence, not a value. */
export function compareValues(a: string, b: string, type: ColumnType): number {
  const left = a ?? ''
  const right = b ?? ''
  if (isBlank(left) || isBlank(right)) return isBlank(left) === isBlank(right) ? 0 : isBlank(left) ? 1 : -1

  if (type === 'number') {
    const x = parseNumber(left)
    const y = parseNumber(right)
    if (x !== null && y !== null) return x - y
  } else if (type === 'date') {
    const x = parseDate(left)
    const y = parseDate(right)
    if (x !== null && y !== null) return x - y
  } else if (type === 'boolean') {
    const x = BOOL_ORDER[left.trim().toLowerCase()]
    const y = BOOL_ORDER[right.trim().toLowerCase()]
    if (x !== undefined && y !== undefined) return x - y
  }
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

export interface SearchOptions {
  caseSensitive: boolean
  /** Restrict the search to one column, or -1 for every column. */
  column: number
}

export function matchesRow(row: string[], needle: string, options: SearchOptions): boolean {
  if (options.column >= 0) {
    const cell = row[options.column] ?? ''
    return (options.caseSensitive ? cell : cell.toLowerCase()).includes(needle)
  }
  for (const cell of row) {
    if ((options.caseSensitive ? cell : cell.toLowerCase()).includes(needle)) return true
  }
  return false
}

/**
 * Builds the visible row order: filter, then sort. Indices point back into the
 * parsed rows, so an edit or an export always reaches the real row.
 */
export function buildOrder(
  rows: string[][],
  start: number,
  query: string,
  search: SearchOptions,
  sort: Sort | null,
  types: ColumnType[],
): number[] {
  const needle = search.caseSensitive ? query : query.toLowerCase()
  const order: number[] = []
  for (let r = start; r < rows.length; r++) {
    if (!needle || matchesRow(rows[r], needle, search)) order.push(r)
  }

  if (sort) {
    const type = types[sort.column] ?? 'text'
    const sign = sort.direction === 'asc' ? 1 : -1
    order.sort((a, b) => {
      const left = rows[a][sort.column] ?? ''
      const right = rows[b][sort.column] ?? ''
      // Blanks are absence, so they stay at the bottom whichever way the
      // column is sorted — flipping them to the top would bury the data.
      if (isBlank(left) || isBlank(right)) {
        if (isBlank(left) && isBlank(right)) return a - b
        return isBlank(left) ? 1 : -1
      }
      // A stable tiebreak on file order keeps equal rows from shuffling when
      // the direction flips.
      const result = compareValues(left, right, type)
      return result === 0 ? a - b : result * sign
    })
  }
  return order
}

/** Spreadsheet column names, for files with no header row: A, B, … Z, AA, AB. */
export function columnName(index: number): string {
  let name = ''
  let n = index
  do {
    name = String.fromCharCode(65 + (n % 26)) + name
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return name
}

export const MIN_COLUMN_WIDTH = 56
export const MAX_COLUMN_WIDTH = 460

/** Roughly one character of the grid's monospace face at its rendered size. */
export const CHAR_WIDTH = 7.4
const WIDTH_PADDING = 24
const WIDTH_SAMPLE = 150

/**
 * Sizes one column from its content rather than giving every column the same
 * slot — a 10-character id next to a 200-character description should not.
 * Measured on a sample, because a million-row file is not worth scanning twice.
 */
export function measureColumn(rows: string[][], start: number, column: number, header: string): number {
  let longest = header.length
  const step = Math.max(1, Math.floor((rows.length - start) / WIDTH_SAMPLE))
  for (let r = start; r < rows.length; r += step) {
    const value = rows[r][column]
    if (value !== undefined && value.length > longest) longest = value.length
  }
  return Math.min(
    MAX_COLUMN_WIDTH,
    Math.max(MIN_COLUMN_WIDTH, Math.round(longest * CHAR_WIDTH + WIDTH_PADDING)),
  )
}

export function initialWidths(rows: string[][], width: number, start: number): number[] {
  const headers = start > 0 ? rows[0] : []
  const widths: number[] = []
  for (let column = 0; column < width; column++) {
    widths.push(measureColumn(rows, start, column, headers[column] ?? columnName(column)))
  }
  return widths
}

/**
 * Whether the first row names the columns. A number or a date up there is data
 * — a real header is words. One unnamed column is tolerated, because an index
 * column with a blank heading is a very common export.
 */
export function looksLikeHeader(rows: string[][], width: number): boolean {
  if (rows.length < 2 || width === 0) return false
  const head = rows[0]
  let named = 0
  for (let c = 0; c < head.length; c++) {
    const cell = (head[c] ?? '').trim()
    if (!cell) continue
    if (parseNumber(cell) !== null || parseDate(cell) !== null) return false
    named++
  }
  return named > 0 && named >= head.length - 1
}

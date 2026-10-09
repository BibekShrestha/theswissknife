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
/** The header's type mark, filter button and resize handle, beside its label. */
const HEADER_CHROME = 40

/**
 * Sizes one column from its content rather than giving every column the same
 * slot — a 10-character id next to a 200-character description should not.
 * Measured on a sample, because a million-row file is not worth scanning twice.
 */
export function measureColumn(rows: string[][], start: number, column: number, header: string): number {
  let longest = 0
  const step = Math.max(1, Math.floor((rows.length - start) / WIDTH_SAMPLE))
  for (let r = start; r < rows.length; r += step) {
    const value = rows[r][column]
    if (value !== undefined && value.length > longest) longest = value.length
  }
  const content = longest * CHAR_WIDTH + WIDTH_PADDING
  const heading = header.length ? header.length * CHAR_WIDTH + WIDTH_PADDING + HEADER_CHROME : 0
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(Math.max(content, heading))))
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

/* ---- column filters ------------------------------------------------- */

export type FilterOp =
  | 'contains'
  | 'not-contains'
  | 'equals'
  | 'not-equals'
  | 'starts'
  | 'ends'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'empty'
  | 'not-empty'

export const FILTER_OPS: { op: FilterOp; label: string }[] = [
  { op: 'contains', label: 'contains' },
  { op: 'not-contains', label: 'does not contain' },
  { op: 'equals', label: '=' },
  { op: 'not-equals', label: '≠' },
  { op: 'starts', label: 'starts with' },
  { op: 'ends', label: 'ends with' },
  { op: 'gt', label: '>' },
  { op: 'gte', label: '≥' },
  { op: 'lt', label: '<' },
  { op: 'lte', label: '≤' },
  { op: 'empty', label: 'is empty' },
  { op: 'not-empty', label: 'is not empty' },
]

/** Ops that need no value typed in — they test presence, not content. */
export const VALUELESS = new Set<FilterOp>(['empty', 'not-empty'])

export interface Filter {
  column: number
  op: FilterOp
  value: string
}

/**
 * Whether one cell passes one filter. Text ops follow the case-sensitivity
 * setting; ordering ops use the column's type, so "> 9" on a number column
 * keeps 10 and drops 9.5. A blank cell is absence: it fails every comparison
 * (and every text test), passing only "is empty" and "≠ something".
 */
export function matchesFilter(cell: string, filter: Filter, type: ColumnType, caseSensitive: boolean): boolean {
  const { op } = filter
  if (op === 'empty') return isBlank(cell)
  if (op === 'not-empty') return !isBlank(cell)
  // A filter still waiting for its value should not empty the grid.
  if (filter.value === '') return true

  const fold = (text: string) => (caseSensitive ? text : text.toLowerCase())
  const value = fold(cell)
  const wanted = fold(filter.value)
  switch (op) {
    case 'contains': return value.includes(wanted)
    case 'not-contains': return !value.includes(wanted)
    case 'starts': return value.startsWith(wanted)
    case 'ends': return value.endsWith(wanted)
    case 'equals':
    case 'not-equals': {
      // Typed equality, so "49" finds "49.00" in a number column.
      const same = isBlank(cell) ? false : equalsTyped(cell, filter.value, type, caseSensitive)
      return op === 'equals' ? same : !same
    }
    default: {
      if (isBlank(cell)) return false
      const result = compareValues(cell, filter.value, type)
      if (op === 'gt') return result > 0
      if (op === 'gte') return result >= 0
      if (op === 'lt') return result < 0
      return result <= 0
    }
  }
}

function equalsTyped(cell: string, wanted: string, type: ColumnType, caseSensitive: boolean): boolean {
  if (type === 'number' || type === 'date' || type === 'boolean') {
    const x = type === 'number' ? parseNumber(cell) : type === 'date' ? parseDate(cell) : BOOL_ORDER[cell.trim().toLowerCase()]
    const y = type === 'number' ? parseNumber(wanted) : type === 'date' ? parseDate(wanted) : BOOL_ORDER[wanted.trim().toLowerCase()]
    if (x !== null && x !== undefined && y !== null && y !== undefined) return x === y
  }
  return caseSensitive ? cell.trim() === wanted.trim() : cell.trim().toLowerCase() === wanted.trim().toLowerCase()
}

/** Keeps the rows of `order` that pass every filter (they are ANDed). */
export function applyFilters(
  rows: string[][],
  order: number[],
  filters: Filter[],
  types: ColumnType[],
  caseSensitive: boolean,
): number[] {
  const active = filters.filter((filter) => VALUELESS.has(filter.op) || filter.value !== '')
  if (active.length === 0) return order
  return order.filter((r) =>
    active.every((filter) =>
      matchesFilter(rows[r][filter.column] ?? '', filter, types[filter.column] ?? 'text', caseSensitive),
    ),
  )
}

/* ---- grouping ------------------------------------------------------- */

export interface Group {
  /** The shared cell value, exactly as written — '' is the blank group. */
  value: string
  /** Row indices in the order they arrived (so the current sort holds within a group). */
  rows: number[]
  /** Column → sum, for every number column other than the grouped one. */
  sums: Map<number, number>
}

/**
 * Splits `order` into groups by one column's value. Groups are ordered by that
 * value using the column's type — following the sort direction when the grid
 * is sorted by the same column — with the blank group last. Rows keep their
 * relative order inside each group.
 */
export function groupRows(
  rows: string[][],
  order: number[],
  column: number,
  types: ColumnType[],
  sort: Sort | null,
): Group[] {
  const byValue = new Map<string, Group>()
  const summed: number[] = []
  for (let c = 0; c < types.length; c++) if (c !== column && types[c] === 'number') summed.push(c)

  for (const r of order) {
    const row = rows[r]
    const raw = row[column] ?? ''
    const key = isBlank(raw) ? '' : raw
    let group = byValue.get(key)
    if (!group) {
      group = { value: key, rows: [], sums: new Map(summed.map((c) => [c, 0])) }
      byValue.set(key, group)
    }
    group.rows.push(r)
    for (const c of summed) {
      const n = parseNumber(row[c] ?? '')
      if (n !== null) group.sums.set(c, (group.sums.get(c) ?? 0) + n)
    }
  }

  const type = types[column] ?? 'text'
  const sign = sort?.column === column && sort.direction === 'desc' ? -1 : 1
  return [...byValue.values()].sort((a, b) => {
    if (a.value === '' || b.value === '') return a.value === b.value ? 0 : a.value === '' ? 1 : -1
    return compareValues(a.value, b.value, type) * sign
  })
}

/**
 * The grid's display list when grouped: each group's header, then its rows
 * unless it is collapsed. Headers are encoded as `~groupIndex` (always
 * negative) so the list stays a flat number[] — a million-row file should not
 * cost a million wrapper objects.
 */
export function groupedDisplay(groups: Group[], collapsed: ReadonlySet<string>): number[] {
  const display: number[] = []
  groups.forEach((group, g) => {
    display.push(~g)
    if (!collapsed.has(group.value)) for (const r of group.rows) display.push(r)
  })
  return display
}

export const isGroupHeader = (item: number) => item < 0
export const groupIndex = (item: number) => ~item

/** Counts a column's values, most common first — the quick picks in a column's filter. */
export function topValues(rows: string[][], start: number, column: number, limit: number): { value: string; count: number }[] {
  const counts = new Map<string, number>()
  for (let r = start; r < rows.length; r++) {
    const value = rows[r][column] ?? ''
    if (isBlank(value)) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { numeric: true }))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }))
}

export function describeFilter(filter: Filter): string {
  const label = FILTER_OPS.find((entry) => entry.op === filter.op)?.label ?? filter.op
  return VALUELESS.has(filter.op) ? label : `${label} ${filter.value}`
}

export interface ColumnProfile {
  /** Distinct non-blank values seen, stopping at `cap` (then `capped` is set). */
  distinct: number
  capped: boolean
  /** Whether every non-blank value seen was different — nothing would group. */
  unique: boolean
  /** The most common values, for a preview. */
  top: string[]
}

/**
 * What grouping by each column would look like, so a picker can say "3
 * values" rather than leave the reader to guess. Reads at most `limit` rows:
 * enough to tell an id column from a category, without stalling on a huge file.
 */
export function profileColumns(rows: string[][], start: number, width: number, limit: number, cap = 1000): ColumnProfile[] {
  const end = Math.min(rows.length, start + limit)
  const profiles: ColumnProfile[] = []
  for (let column = 0; column < width; column++) {
    const counts = new Map<string, number>()
    let seen = 0
    let capped = false
    for (let r = start; r < end; r++) {
      const value = rows[r][column] ?? ''
      if (isBlank(value)) continue
      seen++
      const count = counts.get(value)
      if (count !== undefined) counts.set(value, count + 1)
      else if (counts.size >= cap) capped = true
      else counts.set(value, 1)
    }
    const top = [...counts]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([value]) => value)
    profiles.push({ distinct: counts.size, capped, unique: !capped && seen > 1 && counts.size === seen, top })
  }
  return profiles
}

/**
 * Export writes out what is on screen — the sort order, the active search, and
 * any edits — not the bytes that came in. That is the whole point of filtering
 * a file before you hand it on.
 */

import { columnName, parseFlag, parseNumber, type ColumnType } from './view'

export type Format = 'csv' | 'tsv' | 'json' | 'json-rows' | 'markdown'

export const FILE_META: Record<Format, { ext: string; mime: string; label: string }> = {
  csv: { ext: 'csv', mime: 'text/csv', label: 'CSV' },
  tsv: { ext: 'tsv', mime: 'text/tab-separated-values', label: 'TSV' },
  json: { ext: 'json', mime: 'application/json', label: 'JSON' },
  'json-rows': { ext: 'json', mime: 'application/json', label: 'JSON rows' },
  markdown: { ext: 'md', mime: 'text/markdown', label: 'Markdown' },
}

export interface SerializeOptions {
  format: Format
  delimiter: string
  quote: string
  /** Column headers, or null when the file has no header row. */
  headers: string[] | null
  types: ColumnType[]
  /** Turn plain numbers, booleans and blanks into JSON scalars. */
  inferTypes: boolean
  width: number
}

/** Quote only when the value would otherwise change meaning on the way back. */
export function quoteField(value: string, delimiter: string, quote: string): string {
  if (!quote) return value
  const needs =
    value.includes(delimiter) ||
    value.includes(quote) ||
    value.includes('\n') ||
    value.includes('\r') ||
    value !== value.trim()
  if (!needs) return value
  return quote + value.split(quote).join(quote + quote) + quote
}

export function toDelimited(rows: string[][], width: number, delimiter: string, quote: string): string {
  const lines: string[] = []
  for (const row of rows) {
    const fields: string[] = []
    for (let c = 0; c < width; c++) fields.push(quoteField(row[c] ?? '', delimiter, quote))
    // A lone empty field would be a blank line, which readers skip.
    lines.push(width === 1 && fields[0] === '' && quote ? quote + quote : fields.join(delimiter))
  }
  return lines.join('\n')
}

/**
 * Duplicate headers would silently overwrite each other in a JSON object.
 * Every header that is the first of its name keeps it; later duplicates get
 * the first free `_n` suffix — free of every real header too, so `a,a,a_2`
 * cannot turn into two `a_2` keys.
 */
export function uniqueKeys(headers: string[], width: number): string[] {
  const bases = Array.from({ length: width }, (_, c) => (headers[c] ?? '').trim() || columnName(c))
  const taken = new Set<string>()
  const first: boolean[] = bases.map((base) => (taken.has(base) ? false : (taken.add(base), true)))
  return bases.map((base, c) => {
    if (first[c]) return base
    let n = 2
    while (taken.has(`${base}_${n}`)) n++
    const key = `${base}_${n}`
    taken.add(key)
    return key
  })
}

/** Beyond ~15 significant digits a double silently rounds the value. */
const MAX_SIGNIFICANT_DIGITS = 15

/**
 * A number-typed value as a JSON number — only when the number survives the
 * trip. Leading zeros ("02134" is a zip code), more digits than a double
 * holds, values that overflow to Infinity and -0 stay strings. Digit
 * grouping and trailing zeros do convert: that loses formatting, not value.
 */
function toNumber(value: string): number | null {
  const parsed = parseNumber(value)
  if (parsed === null || !Number.isFinite(parsed) || Object.is(parsed, -0)) return null
  const mantissa = value.trim().replace(/^[+-]/, '').replace(/,/g, '').replace(/[eE].*$/, '')
  if (/^0\d/.test(mantissa)) return null
  const digits = mantissa.replace('.', '').replace(/^0+/, '')
  if (digits.length > MAX_SIGNIFICANT_DIGITS) return null
  return parsed
}

export function toScalar(value: string, type: ColumnType): string | number | boolean | null {
  if (value === '') return null
  if (type === 'number') {
    const parsed = toNumber(value)
    if (parsed !== null) return parsed
  }
  if (type === 'boolean') {
    // Every spelling the column typer accepts — 1/0 included — so one
    // column never exports a mix of booleans and strings.
    const flag = parseFlag(value)
    if (flag !== null) return flag
  }
  return value
}

/** Markdown renders inline HTML, so markup in a cell is escaped, not passed on. */
export const markdownCell = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '\\|')
    .replace(/\r\n|\r|\n/g, '<br>')

export function toMarkdown(rows: string[][], width: number, headers: string[] | null): string {
  const escape = markdownCell
  const head = headers ?? Array.from({ length: width }, (_, c) => columnName(c))
  const lines = [
    `| ${Array.from({ length: width }, (_, c) => escape(head[c] ?? '')).join(' | ')} |`,
    `|${' --- |'.repeat(width)}`,
  ]
  for (const row of rows) {
    lines.push(`| ${Array.from({ length: width }, (_, c) => escape(row[c] ?? '')).join(' | ')} |`)
  }
  return lines.join('\n')
}

export function serialize(rows: string[][], options: SerializeOptions): string {
  const { format, delimiter, quote, headers, types, inferTypes, width } = options

  if (format === 'csv') {
    const body = headers ? [headers, ...rows] : rows
    return toDelimited(body, width, delimiter, quote)
  }
  if (format === 'tsv') {
    const body = headers ? [headers, ...rows] : rows
    return toDelimited(body, width, '\t', quote)
  }
  if (format === 'markdown') return toMarkdown(rows, width, headers)

  const cell = (value: string, column: number) =>
    inferTypes ? toScalar(value, types[column] ?? 'text') : value

  if (format === 'json-rows') {
    return JSON.stringify(
      rows.map((row) => Array.from({ length: width }, (_, c) => cell(row[c] ?? '', c))),
      null,
      2,
    )
  }

  const keys = uniqueKeys(headers ?? [], width)
  return JSON.stringify(
    rows.map((row) => {
      // No prototype: a "__proto__" header must become a key, not a prototype.
      const object: Record<string, unknown> = Object.create(null)
      for (let c = 0; c < width; c++) object[keys[c]] = cell(row[c] ?? '', c)
      return object
    }),
    null,
    2,
  )
}

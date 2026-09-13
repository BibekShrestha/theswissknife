/**
 * Export writes out what is on screen — the sort order, the active search, and
 * any edits — not the bytes that came in. That is the whole point of filtering
 * a file before you hand it on.
 */

import { columnName, parseNumber, type ColumnType } from './view'

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
    lines.push(fields.join(delimiter))
  }
  return lines.join('\n')
}

/** Duplicate headers would silently overwrite each other in a JSON object. */
export function uniqueKeys(headers: string[], width: number): string[] {
  const seen = new Map<string, number>()
  const keys: string[] = []
  for (let c = 0; c < width; c++) {
    const base = (headers[c] ?? '').trim() || columnName(c)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    keys.push(count === 0 ? base : `${base}_${count + 1}`)
  }
  return keys
}

export function toScalar(value: string, type: ColumnType): string | number | boolean | null {
  if (value === '') return null
  if (type === 'number') {
    const parsed = parseNumber(value)
    if (parsed !== null) return parsed
  }
  if (type === 'boolean') {
    const lower = value.trim().toLowerCase()
    if (lower === 'true' || lower === 'yes' || lower === 't' || lower === 'y') return true
    if (lower === 'false' || lower === 'no' || lower === 'f' || lower === 'n') return false
  }
  return value
}

export function toMarkdown(rows: string[][], width: number, headers: string[] | null): string {
  const escape = (value: string) => value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
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
      const object: Record<string, unknown> = {}
      for (let c = 0; c < width; c++) object[keys[c]] = cell(row[c] ?? '', c)
      return object
    }),
    null,
    2,
  )
}

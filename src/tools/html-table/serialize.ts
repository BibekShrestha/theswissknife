/** Grid → CSV / TSV / JSON / Markdown. Pure functions, no DOM. */

export type Format = 'csv' | 'tsv' | 'json' | 'json-rows' | 'markdown'

export interface Grid {
  rows: string[][]
  headerRowCount: number
}

export interface CleanOptions {
  dropEmptyRows: boolean
  dropEmptyCols: boolean
}

const isBlank = (v: string) => v.trim() === ''

/** Drop all-empty rows/columns — the usual spacer-cell debris of scraped HTML. */
export function cleanGrid({ rows, headerRowCount }: Grid, opts: CleanOptions): Grid {
  let out = rows
  let header = headerRowCount

  if (opts.dropEmptyCols && out.length > 0) {
    const width = out[0].length
    const keep: number[] = []
    for (let c = 0; c < width; c++) {
      if (out.some((row) => !isBlank(row[c] ?? ''))) keep.push(c)
    }
    if (keep.length !== width) out = out.map((row) => keep.map((c) => row[c] ?? ''))
  }

  if (opts.dropEmptyRows) {
    const kept: string[][] = []
    out.forEach((row, r) => {
      if (row.some((v) => !isBlank(v))) kept.push(row)
      else if (r < header) header-- // an empty header row stops being a header
    })
    out = kept
  }

  return { rows: out, headerRowCount: Math.min(header, out.length) }
}

/**
 * Column names for object output. Multi-row headers are joined
 * ("2026" + "Q1" → "2026 Q1"); values repeated by a rowspan collapse to one.
 */
export function headerNames({ rows, headerRowCount }: Grid): string[] {
  const width = rows[0]?.length ?? 0
  const names: string[] = []
  for (let c = 0; c < width; c++) {
    const parts: string[] = []
    for (let r = 0; r < headerRowCount; r++) {
      const v = (rows[r]?.[c] ?? '').trim()
      if (v && parts[parts.length - 1] !== v) parts.push(v)
    }
    names.push(parts.join(' ') || `column_${c + 1}`)
  }
  // Duplicate keys would silently overwrite each other in an object.
  const seen = new Map<string, number>()
  return names.map((name) => {
    const n = (seen.get(name) ?? 0) + 1
    seen.set(name, n)
    return n === 1 ? name : `${name}_${n}`
  })
}

/** Plain decimal only: no leading zeros ("007" is an id, not 7), no notation. */
const PLAIN_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/

/** Beyond ~15 significant digits a double silently rounds the value. */
const MAX_SIGNIFICANT_DIGITS = 15

/**
 * String → JSON scalar.
 *
 * Converts only when the value survives intact, so ids, zip codes and long
 * account numbers stay strings. Trailing zeros ("4.50" → 4.5) do convert:
 * that loses display formatting, not value, and refusing would type one
 * column as a mix of numbers and strings.
 */
export function coerce(v: string, inferTypes: boolean): string | number | boolean | null {
  if (!inferTypes) return v
  const t = v.trim()
  if (t === '') return null
  if (t === 'true') return true
  if (t === 'false') return false
  if (t === 'null') return null
  if (PLAIN_NUMBER.test(t)) {
    const digits = t.replace(/^-/, '').replace('.', '').replace(/^0+/, '')
    if (digits.length <= MAX_SIGNIFICANT_DIGITS) return Number(t)
  }
  return v
}

function csvField(v: string, delimiter: string): string {
  return v.includes(delimiter) || /["\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** TSV has no quoting convention, so tabs and newlines become spaces. */
const tsvField = (v: string) => v.replace(/[\t\r\n]+/g, ' ')

const mdCell = (v: string) => v.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim()

function markdown({ rows, headerRowCount }: Grid): string {
  if (rows.length === 0) return ''
  const width = rows[0].length
  const head =
    headerRowCount > 0 ? headerNames({ rows, headerRowCount }) : Array.from({ length: width }, () => '')
  const body = rows.slice(headerRowCount).map((row) => row.map(mdCell))
  // Pad to even columns — a table tool should hand back a readable table.
  const widths = Array.from({ length: width }, (_, c) =>
    Math.max(3, mdCell(head[c] ?? '').length, ...body.map((row) => (row[c] ?? '').length)),
  )
  const line = (cells: string[]) =>
    `| ${cells.map((v, c) => (v ?? '').padEnd(widths[c])).join(' | ')} |`
  return [
    line(head.map(mdCell)),
    `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`,
    ...body.map(line),
  ].join('\n')
}

export interface SerializeOptions extends CleanOptions {
  format: Format
  /** CSV field separator. */
  delimiter: string
  inferTypes: boolean
}

export function serialize(grid: Grid, opts: SerializeOptions): string {
  const clean = cleanGrid(grid, opts)
  const { rows, headerRowCount } = clean
  if (rows.length === 0) return ''

  switch (opts.format) {
    case 'csv':
      return rows.map((row) => row.map((v) => csvField(v, opts.delimiter)).join(opts.delimiter)).join('\n')
    case 'tsv':
      return rows.map((row) => row.map(tsvField).join('\t')).join('\n')
    case 'json': {
      const names = headerNames(clean)
      const objects = rows.slice(headerRowCount).map((row) =>
        Object.fromEntries(names.map((name, c) => [name, coerce(row[c] ?? '', opts.inferTypes)])),
      )
      return JSON.stringify(objects, null, 2)
    }
    case 'json-rows':
      return JSON.stringify(
        rows.map((row) => row.map((v) => coerce(v, opts.inferTypes))),
        null,
        2,
      )
    case 'markdown':
      return markdown(clean)
  }
}

export const FILE_META: Record<Format, { ext: string; mime: string }> = {
  csv: { ext: 'csv', mime: 'text/csv' },
  tsv: { ext: 'tsv', mime: 'text/tab-separated-values' },
  json: { ext: 'json', mime: 'application/json' },
  'json-rows': { ext: 'json', mime: 'application/json' },
  markdown: { ext: 'md', mime: 'text/markdown' },
}

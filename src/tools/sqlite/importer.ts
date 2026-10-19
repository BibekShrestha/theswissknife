/**
 * CSV / TSV / JSON / JSON Lines → SQLite tables.
 *
 * Plain functions over a sql.js Database, like engine.ts, so the tests run
 * them against the real wasm in Node. The worker calls `analyze` to show the
 * plan (columns, types, what was odd about the file) and `importTables` to
 * carry it out; both re-read the file from its bytes, so nothing parsed is
 * held between the two calls.
 *
 * The rules, all of them about not changing what the file said:
 * - a column is INTEGER or REAL only when every non-empty value reads back as
 *   that number; anything that would lose characters stays TEXT and says why
 *   (leading zeros, integers past 2^53, ISO dates, the odd "N/A");
 * - JSON nested objects and arrays are stored as JSON text, so json_extract()
 *   reads them;
 * - ragged CSV rows are padded or widened, never cut, and are counted;
 * - the whole batch is one SAVEPOINT: an error or a cancel rolls it back.
 */
import type { Database, SqlValue } from 'sql.js'
import type { Handoff } from '../../shell/handoff'
import { DEFAULT_OPTIONS, DELIMITER_LABELS, detectDelimiter, parseCsv } from './csvparse'
import { decodeBytes, type Encoding } from './decode'
import { quoteIdent } from './sql'

export type DataFormat = 'csv' | 'json' | 'jsonl'

export interface DataSource {
  name: string
  bytes: Uint8Array
  /** MIME type when known, e.g. "text/csv; header=present" from the CSV viewer. */
  type?: string
  /**
   * Handed over by another tool ("Query with SQL" in the CSV viewer), which
   * writes RFC 4180 comma CSV: the delimiter is known, so it is not sniffed —
   * a column of "a;b" values must not turn into two columns.
   */
  handoff?: boolean
}

export interface ReadOptions {
  format: 'auto' | DataFormat
  /** CSV only. 'auto' sniffs it; a .tsv name or tab-separated type means tab. */
  delimiter: 'auto' | string
  /** CSV only. Whether the first row names the columns. */
  header: 'auto' | 'yes' | 'no'
  /** CSV only: an empty field becomes NULL rather than ''. JSON says null itself. */
  emptyAsNull: boolean
  /** JSON only, for a top-level object: '' imports the object as one row; a key imports the items of that array. */
  jsonRows: string
}

export const DEFAULT_READ: ReadOptions = { format: 'auto', delimiter: 'auto', header: 'auto', emptyAsNull: true, jsonRows: '' }

export type ColumnType = 'INTEGER' | 'REAL' | 'TEXT'

export interface ColumnPlan {
  name: string
  /** The header cell or JSON key it came from, before clean-up. */
  source: string
  type: ColumnType
  /** Why the type is what it is, when that is not obvious. */
  note: string | null
}

export interface RaggedReport {
  /** Fields the header row has. */
  width: number
  /** Rows with fewer fields — the missing ones are NULL. */
  short: number
  /** Rows with more — the extras go into added columns. */
  long: number
  /** First few, as 1-based record numbers in the file (the header is record 1). */
  examples: { record: number; fields: number }[]
}

export interface Analysis {
  format: DataFormat
  /** What decided the format. */
  formatFrom: 'choice' | 'name' | 'type' | 'content'
  encoding: Encoding
  fromBom: boolean
  /** CSV only. */
  delimiter: string | null
  /** CSV only: whether the first row is used as the header, and what the guess was. */
  header: boolean | null
  headerGuess: boolean | null
  columns: ColumnPlan[]
  rows: number
  /** The first rows exactly as they would be stored: INTEGER as bigint, REAL as number. */
  sample: (number | bigint | string | null)[][]
  ragged: RaggedReport | null
  /** Things the reader should know before importing: unterminated quotes, skipped JSON lines. */
  issues: string[]
  /** JSON whose top level is an object: the keys holding arrays, any of which can supply the rows instead. */
  jsonArrays: string[]
}

export interface ImportJob {
  source: DataSource
  options: ReadOptions
  table: string
}

export interface ImportedTable {
  table: string
  rows: number
  columns: number
}

export interface ImportProgress {
  /** 0-based index of the file being imported. */
  file: number
  files: number
  table: string
  phase: 'reading' | 'inserting'
  done: number
  total: number
}

export interface ImportHooks {
  onProgress?: (progress: ImportProgress) => void
  /** Gives the event loop a turn — in the worker, that is when a cancel message gets in. */
  pause?: () => Promise<void>
  cancelled?: () => boolean
  /** How long to insert before reporting progress and pausing. */
  sliceMs?: number
}

export class ImportCancelled extends Error {
  constructor() {
    super('Import cancelled — rolled back, nothing was inserted.')
    this.name = 'ImportCancelled'
  }
}

const SAMPLE_ROWS = 8
const MAX_EXAMPLES = 5
const SAVEPOINT = 'swiss_knife_import'

// ---- names -----------------------------------------------------------------

const DATA_EXTENSIONS = /\.(?:csv|tsv|tab|txt|json|jsonl|ndjson)$/i

export function isDataFileName(name: string): boolean {
  return DATA_EXTENSIONS.test(name)
}

/** SQLite compares identifiers case-insensitively, so "Id" and "id" collide. */
const key = (name: string) => name.toLowerCase()

/**
 * Empty names become column_N; repeats (in any case) get _2, _3. Otherwise a
 * header is kept as written — identifiers are always quoted, so spaces and
 * punctuation are fine.
 */
export function uniqueColumnNames(raw: string[]): string[] {
  const seen = new Set<string>()
  return raw.map((cell, i) => {
    const base = cell.trim() || `column_${i + 1}`
    let name = base
    for (let n = 2; seen.has(key(name)); n++) name = `${base}_${n}`
    seen.add(key(name))
    return name
  })
}

/** "Sales 2024 (Q1).csv" → "Sales_2024_Q1", unique among `taken`. */
export function suggestTableName(fileName: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(key))
  let base = fileName
    .replace(/\.[^.]*$/, '')
    .replace(/[^\p{L}\p{N}_]+/gu, '_')
    .replace(/^_+|_+$/g, '')
  if (!base) base = 'data'
  if (/^\p{N}/u.test(base) || /^sqlite_/i.test(base)) base = `t_${base}`
  let name = base
  for (let n = 2; used.has(key(name)); n++) name = `${base}_${n}`
  return name
}

/** A name already in the schema. Tables, views, indexes and triggers share one namespace in SQLite. */
export type TakenName = string | { name: string; type: string }

/** Why `name` cannot be a new table, or null when it can. Bare strings are the other tables of the same import. */
export function tableNameProblem(name: string, taken: Iterable<TakenName>): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Give the table a name.'
  if (trimmed !== name) return 'The name starts or ends with a space.'
  if (/^sqlite_/i.test(name)) return 'Names starting with sqlite_ are reserved by SQLite.'
  for (const other of taken) {
    const { name: otherName, type } = typeof other === 'string' ? { name: other, type: 'table' } : other
    if (key(otherName) !== key(name)) continue
    if (type === 'table' || type === 'view') return `A ${type} called ${otherName} already exists.`
    return `A${type === 'index' ? 'n' : ''} ${type} called ${otherName} already exists — tables, views, indexes and triggers share one set of names.`
  }
  return null
}

// ---- format ----------------------------------------------------------------

interface Hints {
  format?: DataFormat
  formatFrom?: 'name' | 'type'
  tab?: boolean
  header?: boolean
}

/** What the file name and MIME type say, before looking at the content. */
export function readHints(source: Pick<DataSource, 'name' | 'type'>): Hints {
  const hints: Hints = {}
  const ext = /\.([a-z0-9]+)$/i.exec(source.name)?.[1]?.toLowerCase()
  const mime = (source.type ?? '').toLowerCase()
  const [essence] = mime.split(';').map((part) => part.trim())

  if (ext === 'jsonl' || ext === 'ndjson') Object.assign(hints, { format: 'jsonl', formatFrom: 'name' })
  else if (ext === 'json') Object.assign(hints, { format: 'json', formatFrom: 'name' })
  else if (ext === 'csv' || ext === 'tsv' || ext === 'tab') Object.assign(hints, { format: 'csv', formatFrom: 'name' })
  else if (essence === 'application/x-ndjson' || essence === 'application/jsonl' || essence === 'application/x-jsonlines')
    Object.assign(hints, { format: 'jsonl', formatFrom: 'type' })
  else if (essence === 'application/json') Object.assign(hints, { format: 'json', formatFrom: 'type' })
  else if (essence === 'text/csv' || essence === 'text/tab-separated-values') Object.assign(hints, { format: 'csv', formatFrom: 'type' })

  if (ext === 'tsv' || ext === 'tab' || essence === 'text/tab-separated-values') hints.tab = true
  // RFC 4180 §3 defines this MIME parameter; the CSV viewer sends it.
  const header = /;\s*header\s*=\s*(present|absent)/.exec(mime)?.[1]
  if (header) hints.header = header === 'present'
  return hints
}

function sniffFormat(text: string): DataFormat {
  const first = /\S/.exec(text)?.[0]
  if (first === '[') return 'json'
  if (first === '{') {
    try {
      JSON.parse(text)
      return 'json'
    } catch {
      return 'jsonl'
    }
  }
  return 'csv'
}

export const FORMAT_LABELS: Record<DataFormat, string> = { csv: 'CSV', json: 'JSON', jsonl: 'JSON Lines' }

// ---- values ----------------------------------------------------------------

const INT = /^[+-]?\d+$/
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
const LEADING_ZERO = /^[+-]?0\d/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/

/** 'lossy': a decimal with more significant digits than a double holds. */
type TextClass = 'int' | 'real' | 'lossy' | 'big' | 'leading' | 'date' | 'text'

/** A decimal's value as sign, significant digits and exponent, so 1.50, +1.5 and 15e-1 compare equal. */
function significant(text: string): string {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text)
  if (!m) return text
  const whole = m[2] ?? ''
  let digits = whole + (m[3] ?? '')
  let exponent = Number(m[4] ?? 0) + whole.length
  const lead = /^0*/.exec(digits)![0].length
  digits = digits.slice(lead).replace(/0+$/, '')
  exponent -= lead
  return digits ? `${m[1] === '-' ? '-' : ''}0.${digits}e${exponent}` : '0'
}

/** Whether storing `value` as a REAL keeps its value — only its spelling may change. */
const exactAsDouble = (value: string) => significant(value) === significant(String(Number(value)))

function classifyText(value: string): TextClass {
  if (INT.test(value)) {
    if (LEADING_ZERO.test(value)) return 'leading'
    return Number.isSafeInteger(Number(value)) ? 'int' : 'big'
  }
  if (DECIMAL.test(value)) {
    if (LEADING_ZERO.test(value)) return 'leading'
    if (!Number.isFinite(Number(value))) return 'text'
    return exactAsDouble(value) ? 'real' : 'lossy'
  }
  return ISO_DATE.test(value) ? 'date' : 'text'
}

/** How SQLite shows a REAL: whole numbers keep a ".0", as formatCell writes them. */
const realText = (n: number) => {
  if (Object.is(n, -0)) return '-0.0'
  const text = String(n)
  return Number.isInteger(n) && !/e/i.test(text) ? `${text}.0` : text
}

const quoteExample = (value: string) => {
  const short = value.length > 24 ? `${value.slice(0, 24)}…` : value
  return JSON.stringify(short)
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

class TextTally {
  counts: Record<TextClass, number> = { int: 0, real: 0, lossy: 0, big: 0, leading: 0, date: 0, text: 0 }
  examples: Partial<Record<TextClass, string>> = {}
  /** A number whose text would come back different (+5 → 5) as an INTEGER, and as a REAL (1.50 → 1.5, 2 → 2.0). */
  reshapedInt: string | null = null
  reshapedReal: string | null = null

  add(value: string) {
    const kind = classifyText(value)
    this.counts[kind]++
    this.examples[kind] ??= value
    if (kind !== 'int' && kind !== 'real') return
    if (this.reshapedInt === null && String(Number(value)) !== value) this.reshapedInt = value
    if (this.reshapedReal === null && realText(Number(value)) !== value) this.reshapedReal = value
  }

  decide(): { type: ColumnType; note: string | null } {
    const c = this.counts
    const ex = this.examples
    const numeric = c.int + c.real
    const total = numeric + c.lossy + c.big + c.leading + c.date + c.text
    if (total === 0) return { type: 'TEXT', note: 'no values' }
    if (numeric === total) {
      const type = c.real > 0 ? 'REAL' : 'INTEGER'
      const reshaped = type === 'REAL' ? this.reshapedReal : this.reshapedInt
      const shown = reshaped === null ? '' : type === 'REAL' ? realText(Number(reshaped)) : String(Number(reshaped))
      return { type, note: reshaped !== null ? `stored as numbers: ${reshaped} reads back as ${shown}` : null }
    }
    if (c.lossy > 0 && c.lossy + numeric === total) {
      const lossy = ex.lossy!
      return { type: 'TEXT', note: `kept as text: ${lossy} has more digits than a REAL holds (it would read back as ${realText(Number(lossy))})` }
    }
    const notes: string[] = []
    if (c.lossy > 0) notes.push(`more digits than a REAL holds kept exact (${ex.lossy})`)
    if (c.leading > 0) notes.push(`leading zeros kept (${ex.leading})`)
    if (c.big > 0) notes.push(`integers beyond 2^53 kept exact (${ex.big})`)
    if (c.date > 0 && c.date + c.leading + c.big === total) notes.push('ISO dates kept as text — date() and strftime() read them')
    else if (c.text + c.date > 0 && numeric + c.lossy + c.big + c.leading > 0) {
      notes.push(`${plural(c.text + c.date, 'value')} of ${total.toLocaleString('en-US')} not numbers (${quoteExample(ex.text ?? ex.date ?? '')})`)
    }
    return { type: 'TEXT', note: notes.length ? notes.join('; ') : null }
  }
}

interface RawJson {
  rawJSON: string
}
const jsonApi = JSON as unknown as {
  rawJSON?: (text: string) => RawJson
  isRawJSON?: (value: unknown) => value is RawJson
}
const isRaw = (value: unknown): value is RawJson => jsonApi.isRawJSON?.(value) === true

/**
 * JSON.parse rounds integers past 2^53. Where the engine offers the source
 * text of each number (reviver context + JSON.rawJSON, Chrome 114+, Node 21+,
 * Firefox 135+, Safari 18.4+), those integers are kept as raw JSON instead,
 * which JSON.stringify writes back verbatim.
 */
function parseJson(text: string): unknown {
  const raw = jsonApi.rawJSON
  if (!raw || !/\d{16}/.test(text)) return JSON.parse(text)
  return JSON.parse(text, (_key: string, value: unknown, context?: { source?: string }) =>
    typeof value === 'number' && !Number.isSafeInteger(value) && context?.source && INT.test(context.source)
      ? raw(context.source)
      : value,
  )
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !isRaw(value)

class JsonTally {
  bool = 0
  int = 0
  real = 0
  big = 0
  str = 0
  date = 0
  nested = 0
  rounded = false
  bigExample = ''

  add(value: unknown) {
    if (value === null || value === undefined) return
    if (typeof value === 'boolean') this.bool++
    else if (typeof value === 'number') {
      if (Number.isSafeInteger(value)) this.int++
      else {
        this.real++
        if (Number.isInteger(value) && Math.abs(value) < 1e21) this.rounded = true
      }
    } else if (typeof value === 'string') {
      this.str++
      if (ISO_DATE.test(value)) this.date++
    } else if (isRaw(value)) {
      this.big++
      this.bigExample ||= value.rawJSON
    } else this.nested++
  }

  decide(): { type: ColumnType; note: string | null } {
    const numeric = this.bool + this.int + this.real
    const total = numeric + this.big + this.str + this.nested
    if (total === 0) return { type: 'TEXT', note: 'no values' }
    const rounded = this.rounded ? 'this browser rounds JSON integers beyond 2^53' : null
    if (numeric === total) {
      const notes = [this.bool > 0 ? 'true/false stored as 1/0' : null, rounded].filter(Boolean)
      return { type: this.real > 0 ? 'REAL' : 'INTEGER', note: notes.length ? notes.join('; ') : null }
    }
    const notes: string[] = []
    if (this.nested > 0) notes.push('JSON text — read it with json_extract()')
    if (this.big > 0) notes.push(`integers beyond 2^53 kept exact (${this.bigExample})`)
    if (this.str > 0 && this.date === this.str && this.nested === 0) notes.push('ISO dates kept as text — date() and strftime() read them')
    if (this.str > 0 && numeric > 0) notes.push(`mixed: ${plural(numeric, 'number')} and ${plural(this.str, 'string')}`)
    if (rounded) notes.push(rounded)
    return { type: 'TEXT', note: notes.length ? notes.join('; ') : null }
  }
}

function jsonValue(value: unknown, type: ColumnType): SqlValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return type === 'TEXT' ? String(value) : value ? 1 : 0
  if (typeof value === 'number') return type === 'TEXT' ? String(value) : value
  if (typeof value === 'string') return value
  if (isRaw(value)) return value.rawJSON
  return JSON.stringify(value)
}

// ---- reading ---------------------------------------------------------------

/** A file read and planned: the analysis plus a way to produce each row's values. */
export interface Prepared {
  analysis: Analysis
  row(index: number): SqlValue[]
}

function looksLikeHeader(rows: string[][]): boolean {
  if (rows.length < 2) return false
  const head = rows[0]
  let named = 0
  for (const cell of head) {
    const value = cell.trim()
    if (!value) continue
    const kind = classifyText(value)
    if (kind !== 'text') return false
    named++
  }
  return named > 0 && named >= head.length - 1
}

type Base = Omit<Analysis, 'delimiter' | 'header' | 'headerGuess' | 'columns' | 'rows' | 'sample' | 'ragged' | 'issues' | 'jsonArrays'>

/** Sample rows as stored: an INTEGER column's numbers as bigint, the way query results carry them. */
const asStored = (values: SqlValue[], types: ColumnType[]) =>
  values.map((value, c) => (types[c] === 'INTEGER' && typeof value === 'number' ? BigInt(value) : value)) as (number | bigint | string | null)[]

function prepareCsv(text: string, base: Base, options: ReadOptions, hints: Hints, handoff: boolean): Prepared {
  const delimiter = options.delimiter !== 'auto' ? options.delimiter : handoff ? ',' : hints.tab ? '\t' : detectDelimiter(text).delimiter
  const parsed = parseCsv(text, { ...DEFAULT_OPTIONS, delimiter })
  const { rows } = parsed
  const headerGuess = hints.header ?? looksLikeHeader(rows)
  const header = options.header === 'auto' ? headerGuess : options.header === 'yes'
  const start = header && rows.length > 0 ? 1 : 0
  const width = rows[0]?.length ?? 0
  const fullWidth = parsed.width

  const issues: string[] = []
  const unterminated = parsed.issues.find((issue) => issue.kind === 'unterminated-quote')
  if (unterminated) issues.push(`Record ${unterminated.row + 1}: a quote is never closed, so the rest of the file became one field.`)
  if (parsed.skippedEmpty > 0) issues.push(`${plural(parsed.skippedEmpty, 'blank line')} skipped (a row holding one empty value is written "").`)

  let ragged: RaggedReport | null = null
  for (let r = 1; r < rows.length; r++) {
    const fields = rows[r].length
    if (fields === width) continue
    ragged ??= { width, short: 0, long: 0, examples: [] }
    if (fields < width) ragged.short++
    else ragged.long++
    if (ragged.examples.length < MAX_EXAMPLES) ragged.examples.push({ record: r + 1, fields })
  }

  const rawNames: string[] = []
  for (let c = 0; c < fullWidth; c++) rawNames.push(header && c < width ? (rows[0][c] ?? '') : '')
  const names = uniqueColumnNames(rawNames)

  const tallies = Array.from({ length: fullWidth }, () => new TextTally())
  for (let r = start; r < rows.length; r++) {
    const cells = rows[r]
    for (let c = 0; c < cells.length; c++) if (cells[c] !== '') tallies[c].add(cells[c])
  }
  const columns: ColumnPlan[] = names.map((name, c) => {
    const { type, note } = tallies[c].decide()
    const extra = c >= width ? `added for rows longer than the ${header ? 'header' : 'first row'}` : null
    return { name, source: rawNames[c], type, note: extra ? [extra, note].filter(Boolean).join('; ') : note }
  })

  const types = columns.map((column) => column.type)
  const { emptyAsNull } = options
  const row = (index: number): SqlValue[] => {
    const cells = rows[start + index]
    const out: SqlValue[] = new Array(fullWidth)
    for (let c = 0; c < fullWidth; c++) {
      const value = cells[c]
      if (value === undefined) out[c] = null
      else if (value === '') out[c] = emptyAsNull ? null : ''
      else out[c] = types[c] === 'TEXT' ? value : Number(value)
    }
    return out
  }

  const count = Math.max(0, rows.length - start)
  const sample = Array.from({ length: Math.min(SAMPLE_ROWS, count) }, (_, i) => asStored(row(i), types))
  return {
    analysis: { ...base, delimiter, header, headerGuess, columns, rows: count, sample, ragged, issues, jsonArrays: [] },
    row,
  }
}

function prepareJson(text: string, base: Base, format: 'json' | 'jsonl', jsonRows: string): Prepared {
  const issues: string[] = []
  let jsonArrays: string[] = []
  let records: unknown[]
  let actual = format

  const readLines = () => {
    const out: unknown[] = []
    const bad: number[] = []
    const lines = text.split(/\r\n|\n|\r/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      try {
        out.push(parseJson(line))
      } catch {
        bad.push(i + 1)
      }
    }
    return { out, bad }
  }

  if (format === 'json') {
    let value: unknown
    try {
      value = parseJson(text)
    } catch (error) {
      // A .json file that is really JSON Lines is common enough to recover from.
      const { out, bad } = readLines()
      if (out.length > 1 && bad.length === 0) {
        actual = 'jsonl'
        value = undefined
        records = out
        issues.push('Not one JSON value — read as JSON Lines, one record per line.')
      } else {
        throw new Error(`Not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (actual === 'json') {
      if (Array.isArray(value)) records = value
      else if (isPlainObject(value)) {
        // One object is one record. Its arrays ({"data": [...]}) are offered
        // as the rows instead, but only on request: guessing would turn a
        // record with a "tags" list into rows of tags.
        jsonArrays = Object.keys(value).filter((k) => Array.isArray(value[k]))
        if (jsonRows && jsonArrays.includes(jsonRows)) {
          records = value[jsonRows] as unknown[]
          const others = Object.keys(value).length - 1
          issues.push(`Rows taken from the "${jsonRows}" array${others > 0 ? `; the other ${plural(others, 'key')} were left out` : ''}.`)
        } else {
          records = [value]
          if (jsonArrays.length > 0) {
            issues.push(`One object, imported as one row. To import the items of ${jsonArrays.length === 1 ? `its "${jsonArrays[0]}" array` : 'one of its arrays'} as rows instead, pick it under Rows.`)
          }
        }
      } else records = [value]
    }
  } else {
    const { out, bad } = readLines()
    records = out
    if (bad.length > 0) {
      issues.push(
        `${plural(bad.length, 'line')} not valid JSON and skipped (line ${bad.slice(0, MAX_EXAMPLES).join(', ')}${bad.length > MAX_EXAMPLES ? ', …' : ''}).`,
      )
    }
  }
  records = records!

  // Union of keys, in the order they are first seen.
  const keys: string[] = []
  const seen = new Set<string>()
  let scalars = 0
  for (const record of records) {
    if (isPlainObject(record)) {
      for (const k of Object.keys(record)) {
        if (!seen.has(k)) {
          seen.add(k)
          keys.push(k)
        }
      }
    } else {
      scalars++
      if (!seen.has('value')) {
        seen.add('value')
        keys.push('value')
      }
    }
  }
  if (scalars > 0 && scalars < records.length) issues.push(`${plural(scalars, 'item')} not objects — stored in the "value" column.`)

  const get = (record: unknown, k: string): unknown =>
    isPlainObject(record) ? (Object.hasOwn(record, k) ? record[k] : undefined) : k === 'value' ? record : undefined

  const tallies = keys.map(() => new JsonTally())
  for (const record of records) for (let c = 0; c < keys.length; c++) tallies[c].add(get(record, keys[c]))
  const names = uniqueColumnNames(keys)
  const columns: ColumnPlan[] = names.map((name, c) => ({ name, source: keys[c], ...tallies[c].decide() }))
  const types = columns.map((column) => column.type)

  const row = (index: number): SqlValue[] => {
    const record = records[index]
    return keys.map((k, c) => jsonValue(get(record, k), types[c]))
  }
  const sample = Array.from({ length: Math.min(SAMPLE_ROWS, records.length) }, (_, i) => asStored(row(i), types))
  return {
    analysis: { ...base, format: actual, delimiter: null, header: null, headerGuess: null, columns, rows: records.length, sample, ragged: null, issues, jsonArrays },
    row,
  }
}

/** Decodes, parses and plans one file. Throws when it cannot be read at all. */
export function prepare(source: DataSource, options: ReadOptions): Prepared {
  const { text, encoding, fromBom } = decodeBytes(source.bytes)
  const hints = readHints(source)
  let format: DataFormat
  let formatFrom: Analysis['formatFrom']
  if (options.format !== 'auto') [format, formatFrom] = [options.format, 'choice']
  else if (hints.format) [format, formatFrom] = [hints.format, hints.formatFrom ?? 'name']
  else [format, formatFrom] = [sniffFormat(text), 'content']

  const base = { format, formatFrom, encoding, fromBom }
  return format === 'csv' ? prepareCsv(text, base, options, hints, source.handoff === true) : prepareJson(text, base, format, options.jsonRows ?? '')
}

/** A payload from another tool ("Query with SQL" in the CSV viewer) as a file to import. */
export function handoffSource(handoff: Handoff): DataSource {
  const bytes = handoff.bytes ?? new TextEncoder().encode(handoff.text ?? '')
  return { name: handoff.name, bytes, type: handoff.type, handoff: true }
}

export function analyze(source: DataSource, options: ReadOptions): Analysis {
  return prepare(source, options).analysis
}

export function describeDelimiter(delimiter: string): string {
  return DELIMITER_LABELS[delimiter] ?? JSON.stringify(delimiter)
}

// ---- writing ---------------------------------------------------------------

export function createTableSql(table: string, columns: Pick<ColumnPlan, 'name' | 'type'>[]): string {
  return `CREATE TABLE ${quoteIdent(table)} (${columns.map((c) => `${quoteIdent(c.name)} ${c.type}`).join(', ')})`
}

export function insertSql(table: string, columns: Pick<ColumnPlan, 'name'>[]): string {
  return `INSERT INTO ${quoteIdent(table)} (${columns.map((c) => quoteIdent(c.name)).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
}

function existingNames(db: Database): { name: string; type: string }[] {
  return (db.exec('SELECT name, type FROM sqlite_master')[0]?.values ?? []).map(([name, type]) => ({ name: String(name), type: String(type) }))
}

const yieldTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * Creates and fills one table per job inside a single SAVEPOINT — it nests
 * inside a transaction the user opened in the SQL tab, and starts one when
 * there is none. Inserts run through one prepared statement per table, in
 * slices of `sliceMs`; between slices progress is reported and the event loop
 * gets a turn so a cancel can arrive. An error or a cancel rolls the whole
 * batch back: either every table is there with every row, or none is.
 */
export async function importTables(db: Database, jobs: ImportJob[], hooks: ImportHooks = {}): Promise<ImportedTable[]> {
  const { onProgress, pause = yieldTurn, cancelled = () => false, sliceMs = 100 } = hooks
  const taken = existingNames(db)
  for (const [i, job] of jobs.entries()) {
    const problem = tableNameProblem(job.table, [...taken, ...jobs.slice(0, i).map((j) => j.table)])
    if (problem) throw new Error(`${job.source.name}: ${problem}`)
  }

  const check = () => {
    if (cancelled()) throw new ImportCancelled()
  }

  db.run(`SAVEPOINT ${SAVEPOINT}`)
  try {
    const done: ImportedTable[] = []
    for (const [file, job] of jobs.entries()) {
      const report = (phase: ImportProgress['phase'], rows: number, total: number) =>
        onProgress?.({ file, files: jobs.length, table: job.table, phase, done: rows, total })
      report('reading', 0, 0)
      await pause()
      check()
      const { analysis, row } = prepare(job.source, job.options)
      if (analysis.columns.length === 0) throw new Error(`${job.source.name}: there are no columns to import.`)
      check()
      db.run(createTableSql(job.table, analysis.columns))
      const total = analysis.rows
      report('inserting', 0, total)
      const stmt = db.prepare(insertSql(job.table, analysis.columns))
      try {
        let sliceStart = performance.now()
        for (let i = 0; i < total; i++) {
          stmt.run(row(i))
          if ((i & 255) === 255 && performance.now() - sliceStart >= sliceMs) {
            report('inserting', i + 1, total)
            await pause()
            check()
            sliceStart = performance.now()
          }
        }
      } finally {
        stmt.free()
      }
      report('inserting', total, total)
      done.push({ table: job.table, rows: total, columns: analysis.columns.length })
    }
    await pause()
    check()
    db.run(`RELEASE ${SAVEPOINT}`)
    return done
  } catch (error) {
    try {
      db.run(`ROLLBACK TO ${SAVEPOINT}`)
      db.run(`RELEASE ${SAVEPOINT}`)
    } catch {
      // The savepoint is already gone (SQLite rolled back on a fatal error).
    }
    throw error
  }
}

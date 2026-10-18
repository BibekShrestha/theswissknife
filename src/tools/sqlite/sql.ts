/**
 * Pure helpers: identifier quoting, the SQL the grid generates, the file
 * header, cell formatting and CSV/JSON export. No sql.js in here, so all of
 * it is testable without the wasm.
 */

/** One cell as read with useBigInt: an INTEGER is a bigint, a REAL a number. */
export type Cell = number | string | Uint8Array | bigint | null

/**
 * Quotes an identifier for SQLite: wrap in double quotes, double any inside.
 * Always quoting (rather than only when "needed") means keywords, spaces,
 * quotes and non-ASCII names all take the same path.
 */
export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

export type SortDir = 'asc' | 'desc'
export interface Sort {
  column: string
  dir: SortDir
}

export interface PageQuery {
  table: string
  limit: number
  offset: number
  sort: Sort | null
}

/** The grid's page query. limit/offset are clamped integers, never interpolated raw. */
export function pageSql({ table, limit, offset, sort }: PageQuery): string {
  const lim = Math.max(1, Math.min(10_000, Math.floor(limit) || 1))
  const off = Math.max(0, Math.floor(offset) || 0)
  const order = sort ? ` ORDER BY ${quoteIdent(sort.column)} ${sort.dir === 'desc' ? 'DESC' : 'ASC'}` : ''
  return `SELECT * FROM ${quoteIdent(table)}${order} LIMIT ${lim} OFFSET ${off}`
}

export function countSql(table: string): string {
  return `SELECT count(*) FROM ${quoteIdent(table)}`
}

/** Header click cycle: unsorted → ascending → descending → unsorted. */
export function nextSort(current: Sort | null, column: string): Sort | null {
  if (!current || current.column !== column) return { column, dir: 'asc' }
  return current.dir === 'asc' ? { column, dir: 'desc' } : null
}

// ---- file header ---------------------------------------------------------

const MAGIC = 'SQLite format 3\0'

export function hasSqliteMagic(bytes: Uint8Array): boolean {
  if (bytes.length < MAGIC.length) return false
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC.charCodeAt(i)) return false
  }
  return true
}

/** Why a file can't be opened, or null when it looks like SQLite. */
export function rejectReason(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return 'The file is empty. Use "New empty database" to start from scratch.'
  if (!hasSqliteMagic(bytes)) {
    return 'Not a SQLite database: the file does not start with the "SQLite format 3" header.'
  }
  if (bytes.length < 100) return 'The file is too short to hold a SQLite header (100 bytes).'
  return null
}

export interface FileHeader {
  pageSize: number
  /** 1 = legacy rollback journal, 2 = WAL. */
  writeVersion: number
  readVersion: number
  pageCount: number
  changeCounter: number
  encoding: 'UTF-8' | 'UTF-16le' | 'UTF-16be' | 'unknown'
  userVersion: number
  applicationId: number
  /** SQLITE_VERSION_NUMBER of the library that last wrote the file, e.g. 3045001. */
  versionNumber: number
  /** The same, as "3.45.1". */
  version: string
}

export function versionString(n: number): string {
  if (!n) return 'unknown'
  return `${Math.floor(n / 1_000_000)}.${Math.floor(n / 1000) % 1000}.${n % 1000}`
}

/** Reads the 100-byte database header (https://sqlite.org/fileformat.html). */
export function parseHeader(bytes: Uint8Array): FileHeader | null {
  if (bytes.length < 100 || !hasSqliteMagic(bytes)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, 100)
  const rawPage = view.getUint16(16)
  const enc = view.getUint32(56)
  const versionNumber = view.getUint32(96)
  return {
    pageSize: rawPage === 1 ? 65536 : rawPage,
    writeVersion: bytes[18],
    readVersion: bytes[19],
    changeCounter: view.getUint32(24),
    pageCount: view.getUint32(28),
    encoding: enc === 1 ? 'UTF-8' : enc === 2 ? 'UTF-16le' : enc === 3 ? 'UTF-16be' : 'unknown',
    userVersion: view.getInt32(60),
    applicationId: view.getInt32(68),
    versionNumber,
    version: versionString(versionNumber),
  }
}

// ---- cells ---------------------------------------------------------------

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MiB`
  return `${(n / 1024 ** 3).toFixed(2)} GiB`
}

export function toHex(bytes: Uint8Array, max = Infinity, sep = ''): string {
  const n = Math.min(bytes.length, max)
  const parts: string[] = []
  for (let i = 0; i < n; i++) parts.push(bytes[i].toString(16).padStart(2, '0'))
  return parts.join(sep)
}

export const HEX_PREVIEW_BYTES = 16
const TEXT_PREVIEW_CHARS = 300

export interface FormattedCell {
  kind: 'null' | 'blob' | 'number' | 'text'
  text: string
  /** Full value when `text` is a preview. */
  title?: string
}

/**
 * NULL is its own kind so the grid can style it apart from the string 'NULL';
 * a BLOB shows its size and the first bytes in hex instead of mojibake.
 */
export function formatCell(value: Cell): FormattedCell {
  if (value === null) return { kind: 'null', text: 'NULL' }
  if (value instanceof Uint8Array) {
    const more = value.length > HEX_PREVIEW_BYTES ? ' …' : ''
    const hex = toHex(value, HEX_PREVIEW_BYTES, ' ')
    return {
      kind: 'blob',
      text: `BLOB ${formatBytes(value.length)}${hex ? ` · ${hex}${more}` : ''}`,
      title: `${value.length} bytes`,
    }
  }
  if (typeof value === 'number' || typeof value === 'bigint') return { kind: 'number', text: numberText(value) }
  if (value.length > TEXT_PREVIEW_CHARS) {
    return { kind: 'text', text: `${value.slice(0, TEXT_PREVIEW_CHARS)}…`, title: value.slice(0, 4000) }
  }
  return { kind: 'text', text: value }
}

/**
 * A bigint is an INTEGER and a number is a REAL (engine.ts keeps them apart),
 * so a whole REAL is written the way SQLite writes it — 1.0, -0.0 — rather
 * than passing for an integer.
 */
export function numberText(value: number | bigint): string {
  if (typeof value === 'bigint') return String(value)
  if (Object.is(value, -0)) return '-0.0'
  const text = String(value)
  return Number.isInteger(value) && !/e/i.test(text) ? `${text}.0` : text
}

// ---- export --------------------------------------------------------------

/** BLOBs export as SQL hex literals, so they round-trip and never look like text. */
export function blobLiteral(bytes: Uint8Array): string {
  return `X'${toHex(bytes).toUpperCase()}'`
}

function csvField(value: Cell): string {
  if (value === null) return ''
  const text = value instanceof Uint8Array ? blobLiteral(value) : typeof value === 'string' ? value : numberText(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** RFC 4180: CRLF rows, fields quoted when they hold a comma, quote or line break. NULL is an empty field. */
export function toCsv(columns: string[], rows: Cell[][]): string {
  const lines = [columns.map(csvField), ...rows.map((row) => row.map(csvField))]
  return lines.map((line) => line.join(',')).join('\r\n') + '\r\n'
}

/**
 * Duplicate column names (SELECT 1 a, 2 a) get a " (2)" suffix so no value
 * is lost in an object — skipping any suffix a real column already has
 * (SELECT 1 a, 2 a, 3 "a (2)" gives a, a (3), a (2)).
 */
export function uniqueKeys(columns: string[]): string[] {
  const real = new Set(columns)
  const used = new Set<string>()
  const next = new Map<string, number>()
  return columns.map((name) => {
    if (!used.has(name)) {
      used.add(name)
      return name
    }
    let n = next.get(name) ?? 2
    while (real.has(`${name} (${n})`) || used.has(`${name} (${n})`)) n++
    next.set(name, n + 1)
    const key = `${name} (${n})`
    used.add(key)
    return key
  })
}

function jsonCell(value: Cell): string {
  if (value === null) return 'null'
  if (value instanceof Uint8Array) return JSON.stringify(blobLiteral(value))
  if (typeof value === 'string') return JSON.stringify(value)
  // JSON numbers are doubles: integers past 2^53 travel as strings.
  if (typeof value === 'bigint') return value >= -MAX_SAFE && value <= MAX_SAFE ? String(value) : JSON.stringify(String(value))
  return Number.isFinite(value) ? numberText(value) : 'null'
}
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)

/**
 * Array of row objects, laid out as JSON.stringify(…, null, 2) would. BLOBs
 * become hex literals, integers past 2^53 strings, and a whole REAL keeps
 * its ".0" (JSON.stringify would write 1.0 as 1 and -0.0 as 0).
 */
export function toJson(columns: string[], rows: Cell[][]): string {
  const keys = uniqueKeys(columns).map((key) => JSON.stringify(key))
  if (rows.length === 0) return '[]\n'
  const objects = rows.map((row) =>
    keys.length === 0 ? '  {}' : `  {\n${keys.map((key, i) => `    ${key}: ${jsonCell(row[i] ?? null)}`).join(',\n')}\n  }`,
  )
  return `[\n${objects.join(',\n')}\n]\n`
}

/** "data.db" → "data"; used to name downloads. */
export function fileStem(name: string): string {
  const stem = name.replace(/\.(?:sqlite3?|db3?|s3db|sl3)$/i, '')
  return stem || 'database'
}

/**
 * Everything the worker does to a database, as plain functions over a sql.js
 * Database — so the tests run them against the real wasm in Node, without a
 * worker in the way.
 */
import type { Database, SqlJsStatic, SqlValue } from 'sql.js'
import { countSql, pageSql, rejectReason, type Cell, type PageQuery } from './sql'

/** Rows kept per statement. More would be stepped past and dropped, not held in memory. */
export const ROW_CAP = 10_000

export interface ResultSet {
  sql: string
  columns: string[]
  rows: Cell[][]
  /** True when the statement had more than ROW_CAP rows; only the first ROW_CAP are kept. */
  truncated: boolean
  /** For statements that return no columns (INSERT, UPDATE, CREATE …); null for queries. */
  rowsModified: number | null
  elapsedMs: number
}

export interface ScriptResult {
  results: ResultSet[]
  /** The first failing statement stops the script; earlier statements stay applied. */
  error: { message: string; sql: string } | null
  /** Whether the script changed data or schema — the copy now differs from the file. */
  changed: boolean
  elapsedMs: number
}

const now = () => performance.now()

/** Integers that fit a double become numbers again; only the big ones stay bigint. */
function normalise(value: SqlValue): Cell {
  if (typeof value === 'bigint' && value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value)
  }
  return value
}

function scalar(db: Database, sql: string): SqlValue {
  return db.exec(sql)[0]?.values[0]?.[0] ?? null
}

const totalChanges = (db: Database) => Number(scalar(db, 'SELECT total_changes()'))
const schemaVersion = (db: Database) => Number(scalar(db, 'PRAGMA schema_version'))

export function openDatabase(SQL: SqlJsStatic, bytes: Uint8Array | null): Database {
  if (bytes) {
    const reason = rejectReason(bytes)
    if (reason) throw new Error(reason)
  }
  const db = new SQL.Database(bytes)
  try {
    // sql.js opens lazily; touching the schema is what surfaces a corrupt file.
    db.exec('PRAGMA schema_version')
  } catch (error) {
    db.close()
    throw error
  }
  return db
}

/** Runs every statement in `sql`, keeping up to `cap` rows of each. */
export function runScript(db: Database, sql: string, cap = ROW_CAP): ScriptResult {
  const started = now()
  const changesBefore = totalChanges(db)
  const schemaBefore = schemaVersion(db)
  const results: ResultSet[] = []
  let error: ScriptResult['error'] = null
  const statements = db.iterateStatements(sql)

  try {
    for (const stmt of statements) {
      const t0 = now()
      const text = stmt.getSQL()
      try {
        const before = totalChanges(db)
        const columns = stmt.getColumnNames()
        const rows: Cell[][] = []
        let truncated = false
        while (stmt.step()) {
          if (rows.length >= cap) {
            truncated = true
            break
          }
          rows.push(stmt.get(null, { useBigInt: true }).map(normalise))
        }
        // changes() is sticky — after a CREATE it still reports the last
        // INSERT — so only trust it when total_changes moved.
        const rowsModified = columns.length > 0 ? null : totalChanges(db) === before ? 0 : db.getRowsModified()
        results.push({ sql: text, columns, rows, truncated, rowsModified, elapsedMs: now() - t0 })
      } catch (e) {
        error = { message: e instanceof Error ? e.message : String(e), sql: text }
        break
      } finally {
        stmt.free()
      }
    }
  } catch (e) {
    // Thrown while preparing the next statement — a syntax error.
    error = { message: e instanceof Error ? e.message : String(e), sql: firstLine(statements.getRemainingSQL()) }
  }

  let changed = false
  try {
    changed = totalChanges(db) !== changesBefore || schemaVersion(db) !== schemaBefore
  } catch {
    changed = true
  }
  return { results, error, changed, elapsedMs: now() - started }
}

function firstLine(sql: string): string {
  const line = sql.trim().split('\n')[0] ?? ''
  return line.length > 200 ? `${line.slice(0, 200)}…` : line
}

// ---- schema --------------------------------------------------------------

export interface Column {
  name: string
  type: string
  notNull: boolean
  /** 1-based position in the primary key, 0 when not part of it. */
  pk: number
  defaultValue: string | null
  /** 2/3 = generated column (virtual/stored). Hidden virtual-table columns are left out. */
  generated: boolean
}

export interface SchemaObject {
  type: 'table' | 'view' | 'index' | 'trigger'
  name: string
  /** The table an index or trigger belongs to (the object itself for tables/views). */
  table: string
  sql: string | null
  /** Tables and views: their columns. Indexes: the indexed columns. */
  columns: Column[]
  /** Set when the columns could not be read (e.g. a view over a missing table). */
  error?: string
}

const TYPE_ORDER = "CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 1 WHEN 'index' THEN 2 ELSE 3 END"

export function introspect(db: Database): SchemaObject[] {
  const rows = db.exec(
    `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table','view','index','trigger') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY ${TYPE_ORDER}, name COLLATE NOCASE`,
  )[0]?.values ?? []

  return rows.map(([type, name, table, sql]) => {
    const object: SchemaObject = {
      type: type as SchemaObject['type'],
      name: String(name),
      table: String(table),
      sql: sql === null ? null : String(sql),
      columns: [],
    }
    try {
      if (object.type === 'table' || object.type === 'view') object.columns = tableColumns(db, object.name)
      else if (object.type === 'index') object.columns = indexColumns(db, object.name)
    } catch (error) {
      object.error = error instanceof Error ? error.message : String(error)
    }
    return object
  })
}

function tableColumns(db: Database, name: string): Column[] {
  // The table-valued pragma takes the name as a bound parameter — no quoting to get wrong.
  const values = db.exec('SELECT name, type, "notnull", dflt_value, pk, hidden FROM pragma_table_xinfo(?)', [name])[0]?.values ?? []
  return values
    .filter((row) => Number(row[5]) !== 1)
    .map(([colName, type, notNull, dflt, pk, hidden]) => ({
      name: String(colName),
      type: String(type ?? ''),
      notNull: Number(notNull) === 1,
      pk: Number(pk),
      defaultValue: dflt === null ? null : String(dflt),
      generated: Number(hidden) >= 2,
    }))
}

function indexColumns(db: Database, name: string): Column[] {
  const values = db.exec('SELECT name FROM pragma_index_info(?) ORDER BY seqno', [name])[0]?.values ?? []
  return values.map(([colName]) => ({
    // An expression index column has no name.
    name: colName === null ? '<expression>' : String(colName),
    type: '',
    notNull: false,
    pk: 0,
    defaultValue: null,
    generated: false,
  }))
}

// ---- browsing ------------------------------------------------------------

export function countRows(db: Database, table: string): number {
  return Number(scalar(db, countSql(table)))
}

export interface Page {
  columns: string[]
  rows: Cell[][]
  elapsedMs: number
}

export function readPage(db: Database, query: PageQuery): Page {
  const t0 = now()
  const stmt = db.prepare(pageSql(query))
  try {
    const columns = stmt.getColumnNames()
    const rows: Cell[][] = []
    while (stmt.step()) rows.push(stmt.get(null, { useBigInt: true }).map(normalise))
    return { columns, rows, elapsedMs: now() - t0 }
  } finally {
    stmt.free()
  }
}

// ---- header + pragmas ------------------------------------------------------

/** What the open database reports about itself. The file header is parsed on the main thread, which keeps the bytes. */
export interface DbInfo {
  pageSize: number
  pageCount: number
  encoding: string
  journalMode: string
  userVersion: number
  /** The sql.js engine running in this tab. */
  engineVersion: string
}

export function readInfo(db: Database): DbInfo {
  return {
    pageSize: Number(scalar(db, 'PRAGMA page_size')),
    pageCount: Number(scalar(db, 'PRAGMA page_count')),
    encoding: String(scalar(db, 'PRAGMA encoding')),
    journalMode: String(scalar(db, 'PRAGMA journal_mode')),
    userVersion: Number(scalar(db, 'PRAGMA user_version')),
    engineVersion: String(scalar(db, 'SELECT sqlite_version()')),
  }
}

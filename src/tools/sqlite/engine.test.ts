import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { countRows, introspect, openDatabase, readInfo, readPage, runScript } from './engine'
import { parseHeader } from './sql'

// Runs the REAL sql.js wasm — the engine the worker loads — in Node, where
// sql.js finds its .wasm next to the module on its own.

let SQL: SqlJsStatic

beforeAll(async () => {
  SQL = await initSqlJs()
}, 30_000)

const FIXTURE = `
CREATE TABLE "my ""odd"" table" (
  id INTEGER PRIMARY KEY,
  "first name" TEXT NOT NULL,
  data BLOB,
  score REAL DEFAULT 1.5,
  doubled INTEGER GENERATED ALWAYS AS (id * 2) VIRTUAL
);
CREATE TABLE pairs (a INTEGER, b TEXT, PRIMARY KEY (a, b)) WITHOUT ROWID;
CREATE INDEX idx_name ON "my ""odd"" table" ("first name", lower("first name"));
CREATE VIEW v_names AS SELECT "first name" FROM "my ""odd"" table";
CREATE TRIGGER trg AFTER INSERT ON pairs BEGIN SELECT 1; END;
INSERT INTO "my ""odd"" table" (id, "first name", data, score) VALUES
  (1, 'Ada', x'00ff10', 3.0),
  (2, 'NULL', NULL, NULL),
  (3, 'Grace', NULL, 2.0);
INSERT INTO pairs VALUES (1, 'x'), (2, 'y');
PRAGMA user_version = 7;
`

/** A database file built by SQLite itself, then reopened from its bytes — like a user's file. */
function fixtureBytes(): Uint8Array {
  const db = new SQL.Database()
  db.run(FIXTURE)
  const bytes = db.export()
  db.close()
  return bytes
}

function fixture(): Database {
  return openDatabase(SQL, fixtureBytes())
}

describe('opening', () => {
  it('opens a file built in the test', () => {
    const db = fixture()
    expect(countRows(db, 'pairs')).toBe(2)
  })

  it('rejects non-SQLite bytes before handing them to SQLite', () => {
    expect(() => openDatabase(SQL, new TextEncoder().encode('id,name\n1,Ada\n'))).toThrow(/Not a SQLite database/)
    expect(() => openDatabase(SQL, new Uint8Array())).toThrow(/empty/)
  })

  it('surfaces corruption past a valid magic header', () => {
    const bytes = fixtureBytes()
    bytes.fill(0xab, 16, 100)
    expect(() => openDatabase(SQL, bytes)).toThrow()
  })

  it('opens a new empty database', () => {
    const db = openDatabase(SQL, null)
    expect(introspect(db)).toEqual([])
  })
})

describe('introspection', () => {
  it('lists tables, views, indexes and triggers with their columns', () => {
    const schema = introspect(fixture())
    expect(schema.map((o) => [o.type, o.name])).toEqual([
      ['table', 'my "odd" table'],
      ['table', 'pairs'],
      ['view', 'v_names'],
      ['index', 'idx_name'],
      ['trigger', 'trg'],
    ])

    const odd = schema[0]
    expect(odd.columns).toEqual([
      { name: 'id', type: 'INTEGER', notNull: false, pk: 1, defaultValue: null, generated: false },
      { name: 'first name', type: 'TEXT', notNull: true, pk: 0, defaultValue: null, generated: false },
      { name: 'data', type: 'BLOB', notNull: false, pk: 0, defaultValue: null, generated: false },
      { name: 'score', type: 'REAL', notNull: false, pk: 0, defaultValue: '1.5', generated: false },
      { name: 'doubled', type: 'INTEGER', notNull: false, pk: 0, defaultValue: null, generated: true },
    ])

    const pairs = schema[1]
    expect(pairs.columns.map((c) => [c.name, c.pk])).toEqual([['a', 1], ['b', 2]])

    expect(schema[2].columns.map((c) => c.name)).toEqual(['first name'])
    expect(schema[3].table).toBe('my "odd" table')
    expect(schema[3].columns.map((c) => c.name)).toEqual(['first name', '<expression>'])
    expect(schema[4].table).toBe('pairs')
  })

  it('reports a broken view instead of failing the whole schema', () => {
    const db = openDatabase(SQL, null)
    db.run('CREATE TABLE t (a); CREATE VIEW v AS SELECT a FROM t; DROP TABLE t;')
    const view = introspect(db).find((o) => o.name === 'v')
    expect(view?.error).toMatch(/no such table/)
  })

  it('reads the header and pragmas', () => {
    const bytes = fixtureBytes()
    const header = parseHeader(bytes)!
    const info = readInfo(openDatabase(SQL, bytes))
    expect(header.pageSize).toBe(info.pageSize)
    expect(header.encoding).toBe('UTF-8')
    expect(header.userVersion).toBe(7)
    expect(header.version).toBe(info.engineVersion)
    expect(info).toMatchObject({ encoding: 'UTF-8', journalMode: 'delete', userVersion: 7 })
  })
})

describe('browsing', () => {
  it('pages and sorts a table whose name needs quoting', () => {
    const db = fixture()
    const page = readPage(db, { table: 'my "odd" table', limit: 2, offset: 0, sort: { column: 'first name', dir: 'desc' } })
    expect(page.columns).toEqual(['id', 'first name', 'data', 'score', 'doubled'])
    expect(page.rows.map((r) => r[1])).toEqual(['NULL', 'Grace'])
    const next = readPage(db, { table: 'my "odd" table', limit: 2, offset: 2, sort: { column: 'first name', dir: 'desc' } })
    expect(next.rows.map((r) => r[1])).toEqual(['Ada'])
  })

  it('returns BLOBs as bytes and NULL as null', () => {
    const rows = readPage(fixture(), { table: 'my "odd" table', limit: 10, offset: 0, sort: null }).rows
    expect(rows[0][2]).toEqual(new Uint8Array([0x00, 0xff, 0x10]))
    expect(rows[1][1]).toBe('NULL')
    expect(rows[1][2]).toBeNull()
  })
})

describe('runScript', () => {
  it('runs several statements and reports each', () => {
    const db = fixture()
    const out = runScript(db, `
      INSERT INTO pairs VALUES (3, 'z'), (4, 'w');
      -- a comment between statements
      SELECT a, b FROM pairs ORDER BY a;
      CREATE TABLE t2 (x);
      UPDATE pairs SET b = upper(b) WHERE a > 2;
    `)
    expect(out.error).toBeNull()
    expect(out.changed).toBe(true)
    expect(out.results.map((r) => r.rowsModified)).toEqual([2, null, 0, 2])
    expect(out.results[1].rows).toEqual([[1n, 'x'], [2n, 'y'], [3n, 'z'], [4n, 'w']])
    expect(out.results[1].columns).toEqual(['a', 'b'])
  })

  it('stops at the first error, keeping what ran before', () => {
    const db = fixture()
    const out = runScript(db, "INSERT INTO pairs VALUES (9, 'q'); SELECT * FROM nope; SELECT 1;")
    expect(out.results).toHaveLength(1)
    expect(out.error?.message).toMatch(/no such table: nope/)
    expect(countRows(db, 'pairs')).toBe(3)
  })

  it('reports a syntax error', () => {
    const out = runScript(fixture(), 'SELECT 1; SELEC 2;')
    expect(out.results).toHaveLength(1)
    expect(out.error?.message).toMatch(/syntax error/)
    expect(out.error?.sql).toMatch(/SELEC 2/)
  })

  it('caps rows per statement and says so', () => {
    const db = openDatabase(SQL, null)
    // An unbounded recursive CTE: the cap is what lets it return at all.
    const out = runScript(db, 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT x FROM c', 50)
    expect(out.results[0].rows).toHaveLength(50)
    expect(out.results[0].truncated).toBe(true)
    expect(out.changed).toBe(false)

    const exact = runScript(db, 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c LIMIT 50) SELECT x FROM c', 50)
    expect(exact.results[0].truncated).toBe(false)
  })

  it('keeps integers beyond 2^53 exact', () => {
    const out = runScript(openDatabase(SQL, null), 'SELECT 9007199254740993, 42, 1.5')
    expect(out.results[0].rows[0]).toEqual([9007199254740993n, 42n, 1.5])
  })

  it('round-trips edits through export', () => {
    const db = fixture()
    runScript(db, "DELETE FROM pairs WHERE a = 1")
    const reopened = openDatabase(SQL, db.export())
    expect(countRows(reopened, 'pairs')).toBe(1)
  })
})

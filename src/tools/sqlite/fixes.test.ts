import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseCsv, DEFAULT_OPTIONS } from './csvparse'
import { openDatabase, runScript } from './engine'
import { beforeUnloadHandler, discardMessage } from './guard'
import { analyze, DEFAULT_READ, handoffSource, importTables, tableNameProblem, type DataSource, type ReadOptions } from './importer'
import { formatCell, toCsv, toJson, uniqueKeys } from './sql'

let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs()
}, 30_000)

const enc = new TextEncoder()
const file = (name: string, text: string, type?: string): DataSource => ({ name, bytes: enc.encode(text), type })
const opts = (o: Partial<ReadOptions> = {}): ReadOptions => ({ ...DEFAULT_READ, ...o })
const select = (db: ReturnType<typeof openDatabase>, sql: string) => runScript(db, sql).results[0]

describe('SQL-1: the CSV viewer hand-off keeps the data', () => {
  const csvViewer = (text: string, header = true) => handoffSource({ name: 'x.csv', text, type: `text/csv; charset=utf-8; header=${header ? 'present' : 'absent'}` })

  it('reads a hand-off as comma CSV instead of sniffing the delimiter', async () => {
    const src = csvViewer('v\r\na;b\r\nc;d\r\ne;f\r\n')
    const plan = analyze(src, DEFAULT_READ)
    expect(plan).toMatchObject({ delimiter: ',', rows: 3, columns: [{ name: 'v' }] })
    const db = openDatabase(SQL, null)
    await importTables(db, [{ source: src, options: DEFAULT_READ, table: 't' }])
    expect(select(db, 'SELECT v FROM t').rows).toEqual([['a;b'], ['c;d'], ['e;f']])
    // A dropped file with the same text is still sniffed.
    expect(analyze(file('x.csv', 'v\r\na;b\r\nc;d\r\ne;f\r\n'), DEFAULT_READ).delimiter).toBe(';')
    // A separator the user picks still wins.
    expect(analyze(src, opts({ delimiter: ';' })).delimiter).toBe(';')
  })

  it('keeps a quoted empty single-cell row, and says when blank lines are skipped', async () => {
    expect(parseCsv('a\r\n1\r\n""\r\n3', DEFAULT_OPTIONS).rows).toEqual([['a'], ['1'], [''], ['3']])
    const src = csvViewer('a\r\n1\r\n""\r\n3\r\n')
    expect(analyze(src, DEFAULT_READ).rows).toBe(3)
    const db = openDatabase(SQL, null)
    await importTables(db, [{ source: src, options: DEFAULT_READ, table: 't' }])
    expect(select(db, 'SELECT a FROM t').rows).toEqual([[1n], [null], [3n]])

    const blanks = analyze(file('x.csv', 'a\n1\n\n3\n\n'), DEFAULT_READ)
    expect(blanks.rows).toBe(2)
    expect(blanks.issues.join(' ')).toMatch(/2 blank lines skipped/)
    expect(analyze(file('x.csv', 'a\n1\n3\n'), DEFAULT_READ).issues).toEqual([])
  })
})

describe('SQL-2: numbers that would lose digits stay TEXT', () => {
  it('keeps the column TEXT and says which value would change', async () => {
    const plan = analyze(file('x.csv', 'amount\n1.50\n12345678901234567.89\n'), DEFAULT_READ)
    expect(plan.columns[0]).toMatchObject({ type: 'TEXT', note: expect.stringContaining('12345678901234567.89') })
    const db = openDatabase(SQL, null)
    await importTables(db, [{ source: file('x.csv', 'amount\n1.50\n12345678901234567.89\n'), options: DEFAULT_READ, table: 't' }])
    expect(select(db, 'SELECT amount FROM t').rows).toEqual([['1.50'], ['12345678901234567.89']])
  })

  it('still stores numbers whose text only changes in format as REAL, with the note', () => {
    for (const text of ['n\n1.50\n2.25\n', 'n\n1e3\n0.5\n', 'n\n+1.5\n.5\n', 'n\n0.10000000000000000555\n']) {
      expect(analyze(file('x.csv', text), DEFAULT_READ).columns[0].type, text).toBe(text.includes('555') ? 'TEXT' : 'REAL')
    }
    expect(analyze(file('x.csv', 'n\n1.50\n2.25\n'), DEFAULT_READ).columns[0].note).toContain('1.50 reads back as 1.5')
  })
})

describe('SQL-3: unsaved edits', () => {
  it('only asks when there are unsaved edits', () => {
    expect(discardMessage(null, false, 'Close')).toBeNull()
    expect(discardMessage('app.db', false, 'Close')).toBeNull()
    expect(discardMessage('app.db', true, 'Close')).toMatch(/app\.db.*unsaved edits/)
  })

  it('beforeunload prompts while the database has unsaved edits', () => {
    let unsaved = true
    const handler = beforeUnloadHandler(() => unsaved)
    const event = { preventDefault: () => { prevented = true }, returnValue: '' } as unknown as BeforeUnloadEvent
    let prevented = false
    handler(event)
    expect(prevented).toBe(true)
    unsaved = false
    prevented = false
    handler(event)
    expect(prevented).toBe(false)
  })
})

describe('SQL-4: JSON export keys never collide', () => {
  it('skips generated names that a real column already has', () => {
    expect(uniqueKeys(['a', 'a', 'a (2)'])).toEqual(['a', 'a (3)', 'a (2)'])
    expect(uniqueKeys(['a', 'a', 'a', 'a (3)', 'a (2)'])).toEqual(['a', 'a (4)', 'a (5)', 'a (3)', 'a (2)'])
    const db = openDatabase(SQL, null)
    const result = select(db, 'SELECT 1 a, 2 a, 3 "a (2)"')
    expect(JSON.parse(toJson(result.columns, result.rows))).toEqual([{ a: 1, 'a (3)': 2, 'a (2)': 3 }])
  })
})

describe('SQL-5: names and single JSON objects', () => {
  it('checks every schema name, and says what kind of object holds it', async () => {
    expect(tableNameProblem('ix', [{ name: 'IX', type: 'index' }])).toBe('An index called IX already exists — tables, views, indexes and triggers share one set of names.')
    expect(tableNameProblem('t', [{ name: 't', type: 'table' }])).toMatch(/A table called t already exists/)
    const db = openDatabase(SQL, null)
    db.run('CREATE TABLE a (x); CREATE INDEX people ON a (x); CREATE TRIGGER tr AFTER INSERT ON a BEGIN SELECT 1; END')
    await expect(importTables(db, [{ source: file('p.csv', 'n\n1\n'), options: DEFAULT_READ, table: 'people' }])).rejects.toThrow(/An index called people already exists/)
    await expect(importTables(db, [{ source: file('p.csv', 'n\n1\n'), options: DEFAULT_READ, table: 'TR' }])).rejects.toThrow(/A trigger called tr already exists/)
  })

  it('reads a top-level object as one record unless an array is picked', () => {
    const src = file('x.json', '{"id":7,"name":"x","tags":["a","b"]}')
    const one = analyze(src, DEFAULT_READ)
    expect(one).toMatchObject({ rows: 1, columns: [{ name: 'id' }, { name: 'name' }, { name: 'tags' }], jsonArrays: ['tags'] })
    expect(one.sample[0]).toEqual([7n, 'x', '["a","b"]'])
    expect(one.issues.join(' ')).toMatch(/"tags"/)
    const picked = analyze(src, opts({ jsonRows: 'tags' }))
    expect(picked).toMatchObject({ rows: 2, columns: [{ name: 'value' }] })
    expect(picked.issues.join(' ')).toMatch(/Rows taken from the "tags" array/)
  })
})

describe('SQL-6: REAL values keep their REAL form', () => {
  it('returns INTEGER as bigint and REAL as number, and formats REAL with a fraction', () => {
    const db = openDatabase(SQL, null)
    const { rows } = select(db, 'SELECT 1.0, -0.0, 2, 1.5, 9007199254740993')
    expect(rows[0]).toEqual([1, -0, 2n, 1.5, 9007199254740993n])
    expect(rows[0].map((value) => formatCell(value).text)).toEqual(['1.0', '-0.0', '2', '1.5', '9007199254740993'])
    expect(toCsv(['a', 'b', 'c'], [[1, -0, 2n]])).toBe('a,b,c\r\n1.0,-0.0,2\r\n')
    expect(toJson(['a', 'b', 'c', 'd'], [[1, -0, 2n, 9007199254740993n]])).toBe('[\n  {\n    "a": 1.0,\n    "b": -0.0,\n    "c": 2,\n    "d": "9007199254740993"\n  }\n]\n')
  })
})

import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  analyze,
  DEFAULT_READ,
  ImportCancelled,
  importTables,
  suggestTableName,
  tableNameProblem,
  uniqueColumnNames,
  type DataSource,
  type ImportJob,
  type ImportProgress,
  type ReadOptions,
} from './importer'
import { toCsv, type Cell } from './sql'

// The real sql.js wasm, as in engine.test.ts.

let SQL: SqlJsStatic

beforeAll(async () => {
  SQL = await initSqlJs()
}, 30_000)

const enc = new TextEncoder()
const file = (name: string, text: string, type?: string): DataSource => ({ name, bytes: enc.encode(text), type })
const opts = (o: Partial<ReadOptions> = {}): ReadOptions => ({ ...DEFAULT_READ, ...o })
const job = (source: DataSource, table: string, o: Partial<ReadOptions> = {}): ImportJob => ({ source, options: opts(o), table })

function rows(db: Database, sql: string): { columns: string[]; values: Cell[][] } {
  const result = db.exec(sql)[0]
  return { columns: result?.columns ?? [], values: (result?.values ?? []) as Cell[][] }
}

function typeOf(db: Database, table: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, type] of rows(db, `SELECT name, type FROM pragma_table_info('${table}')`).values) out[String(name)] = String(type)
  return out
}

async function importOne(text: string, name = 'data.csv', o: Partial<ReadOptions> = {}) {
  const db = new SQL.Database()
  await importTables(db, [job(file(name, text), 't', o)])
  return db
}

describe('CSV round trip', () => {
  // RFC 4180 written the way toCsv writes it (CRLF, minimal quoting), so the
  // export must reproduce the file byte for byte.
  const CORPUS = [
    'id,"name, full","quote ""q""",note,zip,big,when,price',
    '1,"Alvarez, R","said ""no""","two\r\nlines",00501,9007199254740993,2024-02-29,1.5',
    '2,Ünïcödé 名前,"""",plain,02134,12345678901234567890,2024-03-01T10:20:30Z,2',
    '3,,,",",10001,-9007199254740993,1999-12-31 23:59,-0.25',
    '4,tab\there,x,"line\nfeed",99999,1,2000-01-01,3e-7',
  ].join('\r\n') + '\r\n'

  it('exports exactly the CSV it imported', async () => {
    const db = await importOne(CORPUS)
    const { columns, values } = rows(db, 'SELECT * FROM t')
    expect(toCsv(columns, values)).toBe(CORPUS)
  })

  it('keeps leading zeros, big integers and dates as text, numbers as numbers', async () => {
    const db = await importOne(CORPUS)
    expect(typeOf(db, 't')).toEqual({
      id: 'INTEGER',
      'name, full': 'TEXT',
      'quote "q"': 'TEXT',
      note: 'TEXT',
      zip: 'TEXT',
      big: 'TEXT',
      when: 'TEXT',
      price: 'REAL',
    })
    const [[big, typeofBig]] = rows(db, 'SELECT big, typeof(big) FROM t WHERE id = 1').values
    expect([big, typeofBig]).toEqual(['9007199254740993', 'text'])
    expect(rows(db, "SELECT date(\"when\", '+1 day') FROM t WHERE id = 1").values[0][0]).toBe('2024-03-01')
  })
})

describe('type inference', () => {
  const plan = (text: string, o: Partial<ReadOptions> = {}) => analyze(file('x.csv', text), opts(o)).columns

  it('says why a numeric-looking column stayed TEXT', () => {
    const [zip, big, when, mixed] = plan('zip,big,when,mixed\n007,9007199254740993,2024-01-02,1\n123,1,2024-01-03,N/A\n')
    expect(zip).toMatchObject({ type: 'TEXT', note: expect.stringContaining('leading zeros') })
    expect(big).toMatchObject({ type: 'TEXT', note: expect.stringContaining('2^53') })
    expect(when).toMatchObject({ type: 'TEXT', note: expect.stringContaining('ISO dates') })
    expect(mixed).toMatchObject({ type: 'TEXT', note: expect.stringContaining('"N/A"') })
  })

  it('treats 2^53 - 1 as an integer and 2^53 + 1 as text', () => {
    expect(plan('n\n9007199254740991\n')[0].type).toBe('INTEGER')
    expect(plan('n\n9007199254740993\n')[0].type).toBe('TEXT')
  })

  it('widens integers to REAL and flags numbers whose text would change', () => {
    const [a, b] = plan('a,b\n1,1.50\n2.5,+3\n')
    expect(a).toMatchObject({ type: 'REAL', note: null })
    expect(b).toMatchObject({ type: 'REAL', note: expect.stringContaining('1.50 reads back as 1.5') })
  })

  it('ignores empty cells when inferring, and stores them as NULL or empty text', async () => {
    const text = 'a,b\n1,\n,\n3,\n'
    expect(plan(text).map((c) => [c.type, c.note])).toEqual([['INTEGER', null], ['TEXT', 'no values']])
    const nulls = await importOne(text)
    expect(rows(nulls, 'SELECT a, b FROM t').values).toEqual([[1, null], [null, null], [3, null]])
    const blanks = await importOne(text, 'data.csv', { emptyAsNull: false })
    expect(rows(blanks, 'SELECT typeof(a), b FROM t').values).toEqual([['integer', ''], ['text', ''], ['integer', '']])
  })
})

describe('headers', () => {
  it('renames empty and duplicate names (case-insensitively, as SQLite compares them)', () => {
    expect(uniqueColumnNames(['id', '', 'Name', 'name', 'NAME', ' padded ', 'id'])).toEqual([
      'id', 'column_2', 'Name', 'name_2', 'NAME_3', 'padded', 'id_2',
    ])
  })

  it('keeps quoted header names with commas and quotes', async () => {
    const db = await importOne('"a,b","say ""hi""",""\n1,2,3\n')
    expect(rows(db, 'SELECT * FROM t').columns).toEqual(['a,b', 'say "hi"', 'column_3'])
  })

  it('guesses whether the first row is a header, and can be overridden', () => {
    expect(analyze(file('x.csv', 'name,age\nAda,36\n'), opts()).header).toBe(true)
    expect(analyze(file('x.csv', '1,2\n3,4\n'), opts()).header).toBe(false)
    const forced = analyze(file('x.csv', 'name,age\nAda,36\n'), opts({ header: 'no' }))
    expect(forced.header).toBe(false)
    expect(forced.headerGuess).toBe(true)
    expect(forced.columns.map((c) => c.name)).toEqual(['column_1', 'column_2'])
    expect(forced.rows).toBe(2)
  })

  it('takes the header from an RFC 4180 header= MIME parameter', () => {
    expect(analyze(file('x', '1,2\n3,4\n', 'text/csv; header=present'), opts()).header).toBe(true)
    expect(analyze(file('x', 'a,b\nc,d\n', 'text/csv; header=absent'), opts()).header).toBe(false)
  })
})

describe('format, delimiter and encoding', () => {
  it('detects TSV by name and semicolons by content', () => {
    expect(analyze(file('x.tsv', 'a\tb\n1\t2\n'), opts()).delimiter).toBe('\t')
    expect(analyze(file('x.csv', 'a;b\n1,5;2,5\n3,5;4\n'), opts()).delimiter).toBe(';')
  })

  it('reports the encoding guess', () => {
    const cp1252 = new Uint8Array([0x6e, 0x61, 0x6d, 0x65, 0x0a, 0x43, 0x61, 0x66, 0xe9, 0x0a]) // name\nCafé (é = 0xE9)
    const a = analyze({ name: 'x.csv', bytes: cp1252 }, opts())
    expect(a.encoding).toBe('windows-1252')
    expect(a.sample).toEqual([['Café']])
    const utf16 = new Uint8Array([0xff, 0xfe, ...[...'n\nx\n'].flatMap((ch) => [ch.charCodeAt(0), 0])])
    expect(analyze({ name: 'x.csv', bytes: utf16 }, opts())).toMatchObject({ encoding: 'utf-16le', fromBom: true })
  })
})

describe('JSON and JSON Lines', () => {
  const records = [
    { id: 1, name: 'Ada', tags: ['math', 'engines'], meta: { born: 1815 }, active: true },
    { id: 2, name: 'Grace', active: false, extra: 'only here' },
    { id: 3, name: null, meta: { born: 1906, place: { city: 'NYC' } } },
  ]

  it('reads a JSON array and the same records as JSONL into the same table', async () => {
    const db = new SQL.Database()
    await importTables(db, [
      job(file('a.json', JSON.stringify(records)), 'a'),
      job(file('b.jsonl', records.map((r) => JSON.stringify(r)).join('\n') + '\n'), 'b'),
    ])
    const a = rows(db, 'SELECT * FROM a')
    expect(a).toEqual(rows(db, 'SELECT * FROM b'))
    // Union of keys in first-seen order; missing keys are NULL.
    expect(a.columns).toEqual(['id', 'name', 'tags', 'meta', 'active', 'extra'])
    expect(a.values[1]).toEqual([2, 'Grace', null, null, 0, 'only here'])
    expect(typeOf(db, 'a')).toMatchObject({ id: 'INTEGER', tags: 'TEXT', meta: 'TEXT', active: 'INTEGER' })
  })

  it('stores nested values as JSON text that json_extract reads', async () => {
    const db = new SQL.Database()
    await importTables(db, [job(file('p.json', JSON.stringify(records)), 'p')])
    expect(rows(db, "SELECT json_extract(meta, '$.place.city'), json_extract(tags, '$[1]') FROM p ORDER BY id").values).toEqual([
      [null, 'engines'],
      [null, null],
      ['NYC', null],
    ])
    const plan = analyze(file('p.json', JSON.stringify(records)), opts()).columns
    expect(plan.find((c) => c.name === 'meta')?.note).toContain('json_extract')
    expect(plan.find((c) => c.name === 'active')?.note).toContain('1/0')
  })

  it('keeps JSON integers beyond 2^53 exact, also inside nested values', async () => {
    const db = new SQL.Database()
    await importTables(db, [job(file('big.json', '[{"id": 9007199254740993, "o": {"n": 12345678901234567890}}]'), 'big')])
    expect(rows(db, 'SELECT id, o FROM big').values).toEqual([['9007199254740993', '{"n":12345678901234567890}']])
  })

  it('reports and skips JSONL lines that do not parse', () => {
    const a = analyze(file('x.jsonl', '{"a":1}\nnot json\n\n{"a":2}\n{oops\n'), opts())
    expect(a.rows).toBe(2)
    expect(a.issues.join(' ')).toMatch(/2 lines not valid JSON and skipped \(line 2, 5\)/)
  })

  it('recovers a .json file that is really JSON Lines, and unwraps {"data": [...]}', () => {
    expect(analyze(file('x.json', '{"a":1}\n{"a":2}\n'), opts())).toMatchObject({ format: 'jsonl', rows: 2 })
    const wrapped = analyze(file('x.json', '{"data":[{"a":1},{"a":2}],"total":2}'), opts())
    expect(wrapped).toMatchObject({ rows: 2, columns: [{ name: 'a' }] })
    expect(wrapped.issues[0]).toContain('"data"')
  })

  it('puts scalars in a value column', () => {
    expect(analyze(file('x.json', '[1, 2, 3]'), opts()).columns).toEqual([{ name: 'value', source: 'value', type: 'INTEGER', note: null }])
  })
})

describe('ragged rows', () => {
  it('counts short and long rows, pads with NULL and keeps the extra fields', async () => {
    const text = 'a,b,c\n1,2,3\n4,5\n6,7,8,9\n10\n'
    const a = analyze(file('x.csv', text), opts())
    expect(a.ragged).toEqual({ width: 3, short: 2, long: 1, examples: [{ record: 3, fields: 2 }, { record: 4, fields: 4 }, { record: 5, fields: 1 }] })
    expect(a.columns[3]).toMatchObject({ name: 'column_4', note: expect.stringContaining('longer than the header') })
    const db = await importOne(text)
    expect(rows(db, 'SELECT * FROM t').values).toEqual([
      [1, 2, 3, null],
      [4, 5, null, null],
      [6, 7, 8, 9],
      [10, null, null, null],
    ])
  })

  it('reports an unterminated quote', () => {
    expect(analyze(file('x.csv', 'a,b\n1,"open\n2,3\n'), opts()).issues[0]).toMatch(/never closed/)
  })
})

describe('table names', () => {
  it('sanitises file names and avoids taken names', () => {
    expect(suggestTableName('Sales 2024 (Q1).csv', [])).toBe('Sales_2024_Q1')
    expect(suggestTableName('2024.csv', [])).toBe('t_2024')
    expect(suggestTableName('sqlite_stat.csv', [])).toBe('t_sqlite_stat')
    expect(suggestTableName('...csv', [])).toBe('data')
    expect(suggestTableName('users.json', ['USERS', 'users_2'])).toBe('users_3')
  })

  it('says what is wrong with a name', () => {
    expect(tableNameProblem('', [])).toMatch(/name/)
    expect(tableNameProblem('sqlite_x', [])).toMatch(/reserved/)
    expect(tableNameProblem('Users', ['users'])).toMatch(/already exists/)
    expect(tableNameProblem('my table', ['users'])).toBeNull()
  })

  it('refuses to import over an existing table', async () => {
    const db = new SQL.Database()
    db.run('CREATE TABLE t (x)')
    await expect(importTables(db, [job(file('t.csv', 'a\n1\n'), 't')])).rejects.toThrow(/already exists/)
  })
})

describe('transaction', () => {
  const big = (n: number) => 'id,label\n' + Array.from({ length: n }, (_, i) => `${i},row ${i}`).join('\n') + '\n'

  it('rolls the whole batch back on cancel — nothing half-inserted', async () => {
    const db = new SQL.Database()
    db.run("CREATE TABLE keep (x); INSERT INTO keep VALUES ('before')")
    let pauses = 0
    const progress: ImportProgress[] = []
    const run = importTables(db, [job(file('one.csv', big(1000)), 'one'), job(file('two.csv', big(50_000)), 'two')], {
      sliceMs: 0,
      onProgress: (p) => progress.push(p),
      pause: async () => {
        pauses++
      },
      // Cancel once the second file is part-way in.
      cancelled: () => progress.some((p) => p.table === 'two' && p.done > 10_000),
    })
    await expect(run).rejects.toBeInstanceOf(ImportCancelled)
    expect(pauses).toBeGreaterThan(5)
    expect(rows(db, "SELECT name FROM sqlite_master WHERE type = 'table'").values).toEqual([['keep']])
    expect(rows(db, 'SELECT x FROM keep').values).toEqual([['before']])
  })

  it('rolls back when a later file fails, and nests inside a transaction the user opened', async () => {
    const db = new SQL.Database()
    db.run('BEGIN')
    await expect(
      importTables(db, [job(file('ok.csv', 'a\n1\n'), 'ok'), job(file('empty.csv', ''), 'empty')]),
    ).rejects.toThrow(/no columns/)
    expect(rows(db, "SELECT count(*) FROM sqlite_master WHERE type = 'table'").values).toEqual([[0]])
    // The user's transaction is still open and usable.
    db.run('CREATE TABLE mine (x); COMMIT')
    expect(rows(db, "SELECT name FROM sqlite_master WHERE type = 'table'").values).toEqual([['mine']])
  })

  it('imports a large file in slices, without long stretches between pauses', async () => {
    const n = 200_000
    const text = 'id,name,score,when,code,flag\n' +
      Array.from({ length: n }, (_, i) => `${i},name ${i},${(i * 0.37).toFixed(2)},2024-01-${String((i % 28) + 1).padStart(2, '0')},${String(i % 1000).padStart(4, '0')},${i % 2}`).join('\n')
    const db = new SQL.Database()
    let last = performance.now()
    let longest = 0
    const started = performance.now()
    const [result] = await importTables(db, [job(file('large.csv', text), 'large')], {
      pause: async () => {
        const now = performance.now()
        longest = Math.max(longest, now - last)
        await new Promise((resolve) => setTimeout(resolve, 0))
        last = performance.now()
      },
    })
    const elapsed = performance.now() - started
    expect(result).toEqual({ table: 'large', rows: n, columns: 6 })
    expect(rows(db, 'SELECT count(*), sum(id) FROM large').values).toEqual([[n, (n * (n - 1)) / 2]])
    expect(typeOf(db, 'large')).toEqual({ id: 'INTEGER', name: 'TEXT', score: 'REAL', when: 'TEXT', code: 'TEXT', flag: 'INTEGER' })
    // Generous for slow CI: this takes about a second on a laptop.
    expect(elapsed).toBeLessThan(20_000)
    // Inserting yields every ~100 ms; parsing the file is the one long stretch.
    expect(longest).toBeLessThan(5_000)
  }, 60_000)
})

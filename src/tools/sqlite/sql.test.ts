import { describe, expect, it } from 'vitest'
import {
  countSql,
  fileStem,
  formatCell,
  hasSqliteMagic,
  nextSort,
  pageSql,
  parseHeader,
  quoteIdent,
  rejectReason,
  toCsv,
  toJson,
  versionString,
} from './sql'

describe('quoteIdent', () => {
  it('double-quotes and doubles embedded quotes', () => {
    expect(quoteIdent('users')).toBe('"users"')
    expect(quoteIdent('my table')).toBe('"my table"')
    expect(quoteIdent('a"b')).toBe('"a""b"')
    expect(quoteIdent('"; DROP TABLE x; --')).toBe('"""; DROP TABLE x; --"')
    expect(quoteIdent('select')).toBe('"select"')
  })
})

describe('page SQL', () => {
  it('builds LIMIT/OFFSET with an optional ORDER BY', () => {
    expect(pageSql({ table: 't', limit: 100, offset: 200, sort: null })).toBe('SELECT * FROM "t" LIMIT 100 OFFSET 200')
    expect(pageSql({ table: 'my "t"', limit: 10, offset: 0, sort: { column: 'first name', dir: 'desc' } })).toBe(
      'SELECT * FROM "my ""t""" ORDER BY "first name" DESC LIMIT 10 OFFSET 0',
    )
  })

  it('clamps limit and offset to sane integers', () => {
    expect(pageSql({ table: 't', limit: 0, offset: -5, sort: null })).toBe('SELECT * FROM "t" LIMIT 1 OFFSET 0')
    expect(pageSql({ table: 't', limit: 1e9, offset: 2.7, sort: null })).toBe('SELECT * FROM "t" LIMIT 10000 OFFSET 2')
    expect(pageSql({ table: 't', limit: Number.NaN, offset: Number.NaN, sort: null })).toBe('SELECT * FROM "t" LIMIT 1 OFFSET 0')
  })

  it('counts with the same quoting', () => {
    expect(countSql('a b')).toBe('SELECT count(*) FROM "a b"')
  })

  it('cycles sort asc → desc → off, restarting on a new column', () => {
    const asc = nextSort(null, 'a')
    expect(asc).toEqual({ column: 'a', dir: 'asc' })
    const desc = nextSort(asc, 'a')
    expect(desc).toEqual({ column: 'a', dir: 'desc' })
    expect(nextSort(desc, 'a')).toBeNull()
    expect(nextSort(desc, 'b')).toEqual({ column: 'b', dir: 'asc' })
  })
})

function header(overrides: (bytes: Uint8Array, view: DataView) => void = () => {}): Uint8Array {
  const bytes = new Uint8Array(4096)
  bytes.set(new TextEncoder().encode('SQLite format 3\0'))
  const view = new DataView(bytes.buffer)
  view.setUint16(16, 4096)
  bytes[18] = 1
  bytes[19] = 1
  view.setUint32(28, 1)
  view.setUint32(56, 1)
  view.setUint32(96, 3045001)
  overrides(bytes, view)
  return bytes
}

describe('file header', () => {
  it('checks the magic string, including its NUL', () => {
    expect(hasSqliteMagic(header())).toBe(true)
    expect(hasSqliteMagic(new TextEncoder().encode('SQLite format 3 and then some'))).toBe(false)
    expect(hasSqliteMagic(new TextEncoder().encode('SQLite'))).toBe(false)
  })

  it('rejects non-SQLite files with a reason', () => {
    expect(rejectReason(header())).toBeNull()
    expect(rejectReason(new Uint8Array())).toMatch(/empty/)
    expect(rejectReason(new TextEncoder().encode('PK\x03\x04 a zip file'))).toMatch(/Not a SQLite database/)
    expect(rejectReason(header().slice(0, 50))).toMatch(/too short/)
  })

  it('parses page size, encoding, journal mode and writer version', () => {
    expect(parseHeader(header())).toMatchObject({
      pageSize: 4096,
      writeVersion: 1,
      encoding: 'UTF-8',
      version: '3.45.1',
      pageCount: 1,
    })
    const wal = parseHeader(header((b, v) => {
      b[18] = 2
      b[19] = 2
      v.setUint16(16, 1)
      v.setUint32(56, 3)
    }))
    expect(wal).toMatchObject({ pageSize: 65536, writeVersion: 2, encoding: 'UTF-16be' })
    expect(parseHeader(new Uint8Array(100))).toBeNull()
  })

  it('formats SQLITE_VERSION_NUMBER', () => {
    expect(versionString(3049001)).toBe('3.49.1')
    expect(versionString(3008011)).toBe('3.8.11')
    expect(versionString(0)).toBe('unknown')
  })
})

describe('formatCell', () => {
  it('keeps NULL apart from the string NULL', () => {
    expect(formatCell(null)).toEqual({ kind: 'null', text: 'NULL' })
    expect(formatCell('NULL')).toEqual({ kind: 'text', text: 'NULL' })
  })

  it('shows BLOB size and a hex preview', () => {
    expect(formatCell(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toMatchObject({ kind: 'blob', text: 'BLOB 4 B · 89 50 4e 47' })
    const big = formatCell(new Uint8Array(2048).fill(0xab))
    expect(big.text).toBe(`BLOB 2.0 KiB · ${Array(16).fill('ab').join(' ')} …`)
    expect(formatCell(new Uint8Array())).toMatchObject({ text: 'BLOB 0 B' })
  })

  it('formats numbers and previews long text', () => {
    expect(formatCell(42)).toEqual({ kind: 'number', text: '42' })
    expect(formatCell(9007199254740993n)).toEqual({ kind: 'number', text: '9007199254740993' })
    const long = formatCell('x'.repeat(1000))
    expect(long.text).toHaveLength(301)
    expect(long.title).toHaveLength(1000)
  })
})

describe('export', () => {
  it('escapes CSV fields per RFC 4180', () => {
    const csv = toCsv(['id', 'note, with comma', 'q'], [
      [1, 'plain', 'say "hi"'],
      [2, 'line\nbreak', null],
      [3, 'cr\rhere', new Uint8Array([0xde, 0xad])],
    ])
    expect(csv).toBe(
      'id,"note, with comma",q\r\n' +
        '1,plain,"say ""hi"""\r\n' +
        '2,"line\nbreak",\r\n' +
        '3,"cr\rhere",X\'DEAD\'\r\n',
    )
  })

  it('writes JSON objects, de-duplicating column names', () => {
    const json = JSON.parse(toJson(['a', 'a', 'b', 'c'], [[1, 2, new Uint8Array([1]), 9007199254740993n], [null, 'x', null, 3]]))
    expect(json).toEqual([
      { a: 1, 'a (2)': 2, b: "X'01'", c: '9007199254740993' },
      { a: null, 'a (2)': 'x', b: null, c: 3 },
    ])
  })

  it('names downloads after the file', () => {
    expect(fileStem('app.db')).toBe('app')
    expect(fileStem('Chinook.sqlite3')).toBe('Chinook')
    expect(fileStem('notes')).toBe('notes')
    expect(fileStem('.db')).toBe('database')
  })
})

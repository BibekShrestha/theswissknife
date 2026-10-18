import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { introspect, openDatabase, runScript } from './engine'
import { analyze, DEFAULT_READ, handoffSource, ImportCancelled, importTables, type ImportProgress } from './importer'
import { createSqliteRunner, ImportCancelledError, SqliteTimeoutError, type WorkerLike } from './runner'
import type { SqliteReply, SqliteRequest } from './types'

vi.mock('../../shell/router', () => ({ navigate: vi.fn() }))

let SQL: SqlJsStatic

beforeAll(async () => {
  SQL = await initSqlJs()
}, 30_000)

/**
 * Behaves like sqlite.worker.ts — the real engine and importer, progress
 * replies, cancel messages handled between slices — with a short slice so the
 * tests see many of them. A file named "hang.csv" never answers.
 */
function fakeWorker(sliceMs = 5, pauseMs = 0) {
  let db: Database | null = null
  const cancelled = new Set<number>()
  const worker: WorkerLike & { terminated: boolean } = {
    onmessage: null,
    onerror: null,
    terminated: false,
    postMessage(req: SqliteRequest) {
      if (worker.terminated) return
      const reply = (r: SqliteReply) => {
        if (!worker.terminated) worker.onmessage?.({ data: r } as MessageEvent<SqliteReply>)
      }
      if (req.type === 'cancel') {
        cancelled.add(req.id)
        return
      }
      if (req.type === 'import' && req.jobs.some((j) => j.source.name === 'hang.csv')) return
      setTimeout(async () => {
        try {
          let value: unknown
          if (req.type === 'open') value = Boolean((db = openDatabase(SQL, req.bytes)))
          else if (req.type === 'exec') value = runScript(db!, req.sql)
          else if (req.type === 'schema') value = introspect(db!)
          else if (req.type === 'analyze') value = analyze(req.source, req.options)
          else if (req.type === 'import') {
            value = await importTables(db!, req.jobs, {
              sliceMs,
              onProgress: (progress) => reply({ id: req.id, progress }),
              pause: () => new Promise((resolve) => setTimeout(resolve, pauseMs)),
              cancelled: () => cancelled.has(req.id),
            })
          } else throw new Error(`fake worker: ${req.type} not implemented`)
          reply({ id: req.id, ok: true, value })
        } catch (error) {
          reply({ id: req.id, ok: false, error: (error as Error).message, cancelled: error instanceof ImportCancelled })
        }
      }, 0)
    },
    terminate() {
      worker.terminated = true
    },
  }
  return worker
}

const csv = (n: number) => 'id,label\n' + Array.from({ length: n }, (_, i) => `${i},row ${i}`).join('\n') + '\n'
const source = (name: string, text: string) => ({ name, bytes: new TextEncoder().encode(text) })
const tables = (objects: { type: string; name: string }[]) => objects.filter((o) => o.type === 'table').map((o) => o.name)

describe('import through the runner', () => {
  it('analyzes without an open database, then imports with progress', async () => {
    const runner = createSqliteRunner(() => fakeWorker())
    const plan = await runner.analyze({ source: source('people.csv', 'name,age\nAda,36\n'), options: DEFAULT_READ })
    expect(plan.columns.map((c) => `${c.name} ${c.type}`)).toEqual(['name TEXT', 'age INTEGER'])

    await runner.open(null)
    const progress: ImportProgress[] = []
    const result = await runner.importData([{ source: source('n.csv', csv(30_000)), options: DEFAULT_READ, table: 'n' }], {
      onProgress: (p) => progress.push(p),
    })
    expect(result).toEqual([{ table: 'n', rows: 30_000, columns: 2 }])
    expect(progress[0]).toMatchObject({ phase: 'reading', file: 0, files: 1 })
    expect(progress.at(-1)).toMatchObject({ phase: 'inserting', done: 30_000, total: 30_000 })
    expect(tables(await runner.call('schema', {}))).toEqual(['n'])
    runner.dispose()
  })

  it('does not hold an import to the query deadline while it keeps reporting progress', async () => {
    // Stall budget 150 ms; with a 40 ms pause per slice the import takes far longer in total.
    const runner = createSqliteRunner(() => fakeWorker(5, 40), { timeoutMs: 50, importStallMs: 150 })
    await runner.open(null)
    const started = performance.now()
    const [result] = await runner.importData([{ source: source('n.csv', csv(60_000)), options: DEFAULT_READ, table: 'n' }])
    expect(result.rows).toBe(60_000)
    expect(performance.now() - started).toBeGreaterThan(150)
    runner.dispose()
  })

  it('stops an import that goes silent, and says so', async () => {
    const runner = createSqliteRunner(() => fakeWorker(), { importStallMs: 50 })
    await runner.open(null)
    const error = await runner.importData([{ source: source('hang.csv', 'a\n1\n'), options: DEFAULT_READ, table: 'h' }]).catch((e) => e)
    expect(error).toBeInstanceOf(SqliteTimeoutError)
    expect(error.message).toMatch(/import reported no progress/)
    runner.dispose()
  })

  it('cancels: the batch rolls back and earlier data is untouched', async () => {
    const runner = createSqliteRunner(() => fakeWorker())
    await runner.open(null)
    await runner.call('exec', { sql: "CREATE TABLE keep (x); INSERT INTO keep VALUES ('kept')" })
    const controller = new AbortController()
    const run = runner.importData(
      [
        { source: source('a.csv', csv(5_000)), options: DEFAULT_READ, table: 'a' },
        { source: source('b.csv', csv(200_000)), options: DEFAULT_READ, table: 'b' },
      ],
      {
        onProgress: (p) => {
          if (p.table === 'b' && p.done > 0) controller.abort()
        },
        signal: controller.signal,
      },
    )
    const error = await run.catch((e) => e)
    expect(error).toBeInstanceOf(ImportCancelledError)
    expect(error.message).toMatch(/rolled back/)
    expect(tables(await runner.call('schema', {}))).toEqual(['keep'])
    const check = await runner.call('exec', { sql: 'SELECT x FROM keep' })
    expect(check.results[0].rows).toEqual([['kept']])
    runner.dispose()
  })
})

describe('handoff from the CSV viewer', () => {
  it('is taken once, then imports as a table', async () => {
    const { sendTo, takeHandoff } = await import('../../shell/handoff')
    const { navigate } = await import('../../shell/router')
    sendTo('sqlite', { name: 'people.csv', text: '1,Ada\n2,Grace\n', type: 'text/csv; header=absent' })
    expect(navigate).toHaveBeenCalledWith('/sqlite')

    const handoff = takeHandoff('sqlite')
    expect(handoff?.name).toBe('people.csv')
    expect(takeHandoff('sqlite')).toBeNull()

    const src = handoffSource(handoff!)
    const plan = analyze(src, DEFAULT_READ)
    expect(plan).toMatchObject({ format: 'csv', header: false, rows: 2 })

    const db = new SQL.Database()
    await importTables(db, [{ source: src, options: DEFAULT_READ, table: 'people' }])
    expect(db.exec('SELECT * FROM people')[0].values).toEqual([[1, 'Ada'], [2, 'Grace']])
  })

  it('accepts bytes as well as text', () => {
    const src = handoffSource({ name: 'x.json', bytes: new TextEncoder().encode('[{"a":1}]') })
    expect(analyze(src, DEFAULT_READ)).toMatchObject({ format: 'json', rows: 1 })
  })
})

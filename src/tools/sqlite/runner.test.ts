import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { countRows, introspect, openDatabase, runScript } from './engine'
import { createSqliteRunner, SqliteTimeoutError, type WorkerLike } from './runner'
import type { SqliteReply, SqliteRequest } from './types'

let SQL: SqlJsStatic

beforeAll(async () => {
  SQL = await initSqlJs()
}, 30_000)

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Answers like sqlite.worker.ts, backed by the real engine — except that any
 * exec containing HANG never replies, standing in for a recursive CTE that
 * never ends (a real one would block this test's thread too).
 */
function fakeWorker() {
  let db: Database | null = null
  const worker: WorkerLike & { terminated: boolean; opens: number } = {
    onmessage: null,
    onerror: null,
    terminated: false,
    opens: 0,
    postMessage(req: SqliteRequest) {
      if (worker.terminated) return
      if (req.type === 'exec' && req.sql.includes('HANG')) return
      queueMicrotask(() => {
        let reply: SqliteReply
        try {
          let value: unknown
          if (req.type === 'open') {
            db = openDatabase(SQL, req.bytes)
            worker.opens++
            value = true
          } else if (req.type === 'exec') value = runScript(db!, req.sql)
          else if (req.type === 'schema') value = introspect(db!)
          else if (req.type === 'count') value = countRows(db!, req.table)
          else throw new Error(`fake worker: ${req.type} not implemented`)
          reply = { id: req.id, ok: true, value }
        } catch (error) {
          reply = { id: req.id, ok: false, error: (error as Error).message }
        }
        worker.onmessage?.({ data: reply } as MessageEvent<SqliteReply>)
      })
    },
    terminate() {
      worker.terminated = true
    },
  }
  return worker
}

function fileBytes(): Uint8Array {
  const db = new SQL.Database()
  db.run("CREATE TABLE t (a); INSERT INTO t VALUES (1), (2);")
  return db.export()
}

describe('sqlite runner', () => {
  it('opens once and reuses the worker', async () => {
    const spawn = vi.fn(() => fakeWorker())
    const runner = createSqliteRunner(spawn)
    await runner.open(fileBytes())
    expect(await runner.call('count', { table: 't' })).toBe(2)
    const out = await runner.call('exec', { sql: 'SELECT a FROM t' })
    expect(out.results[0].rows).toEqual([[1], [2]])
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('passes SQLite errors through without killing the worker', async () => {
    const spawn = vi.fn(() => fakeWorker())
    const runner = createSqliteRunner(spawn)
    await runner.open(fileBytes())
    await expect(runner.call('count', { table: 'missing' })).rejects.toThrow(/no such table/)
    expect(await runner.call('count', { table: 't' })).toBe(2)
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('rejects a non-SQLite file on open', async () => {
    const runner = createSqliteRunner(() => fakeWorker())
    await expect(runner.open(new TextEncoder().encode('not a database at all'))).rejects.toThrow(/Not a SQLite database/)
    await expect(runner.call('schema', {})).rejects.toThrow(/No database is open/)
  })

  it('kills a runaway query and reopens the original bytes, dropping edits', async () => {
    vi.useFakeTimers()
    const workers: ReturnType<typeof fakeWorker>[] = []
    const spawn = vi.fn(() => {
      const w = fakeWorker()
      workers.push(w)
      return w
    })
    const runner = createSqliteRunner(spawn, { timeoutMs: 1000 })
    await runner.open(fileBytes())
    await runner.call('exec', { sql: 'INSERT INTO t VALUES (3)' })
    expect(await runner.call('count', { table: 't' })).toBe(3)

    const pending = runner.call('exec', { sql: 'HANG' })
    const settled = expect(pending).rejects.toBeInstanceOf(SqliteTimeoutError)
    await vi.advanceTimersByTimeAsync(1000)
    await settled
    await expect(pending).rejects.toThrow(/Stopped after 1 s.*reopened from the original file.*unsaved changes/)
    expect(workers[0].terminated).toBe(true)

    // Next call: fresh worker, original file — the INSERT is gone.
    expect(await runner.call('count', { table: 't' })).toBe(2)
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(workers[1].opens).toBe(1)
  })

  it('resets an empty database to empty after a timeout', async () => {
    vi.useFakeTimers()
    const runner = createSqliteRunner(() => fakeWorker(), { timeoutMs: 500 })
    await runner.open(null)
    await runner.call('exec', { sql: 'CREATE TABLE x (a)' })
    const pending = runner.call('exec', { sql: 'HANG' })
    const settled = expect(pending).rejects.toThrow(/new empty one/)
    await vi.advanceTimersByTimeAsync(500)
    await settled
    expect(await runner.call('schema', {})).toEqual([])
  })

  it('queues calls so each gets its own deadline', async () => {
    vi.useFakeTimers()
    const runner = createSqliteRunner(() => fakeWorker(), { timeoutMs: 1000 })
    await runner.open(fileBytes())
    const hung = runner.call('exec', { sql: 'HANG' })
    const after = runner.call('count', { table: 't' })
    const hungSettled = expect(hung).rejects.toBeInstanceOf(SqliteTimeoutError)
    await vi.advanceTimersByTimeAsync(1000)
    await hungSettled
    expect(await after).toBe(2)
  })

  it('reports a crashed worker and recovers', async () => {
    const workers: ReturnType<typeof fakeWorker>[] = []
    const runner = createSqliteRunner(() => {
      const w = fakeWorker()
      workers.push(w)
      return w
    })
    await runner.open(fileBytes())
    const pending = runner.call('exec', { sql: 'HANG' })
    await Promise.resolve()
    await Promise.resolve()
    workers[0].onerror?.(new Event('error') as ErrorEvent)
    await expect(pending).rejects.toThrow(/crashed/)
    expect(await runner.call('count', { table: 't' })).toBe(2)
  })

  it('stops answering after dispose', async () => {
    const runner = createSqliteRunner(() => fakeWorker())
    await runner.open(fileBytes())
    runner.dispose()
    await expect(runner.call('count', { table: 't' })).rejects.toThrow(/closed/)
  })
})

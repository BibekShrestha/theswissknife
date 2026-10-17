import type { SqliteCall, SqliteCalls, SqliteReply, SqliteRequest } from './types'

/** How long one statement batch may run before the worker is stopped. */
export const QUERY_TIMEOUT_MS = 10_000
/** Opening parses nothing up front, but a large file still has to be copied into the wasm heap. */
export const OPEN_TIMEOUT_MS = 60_000

/** The subset of Worker the runner touches — lets tests drive it with a fake. */
export interface WorkerLike {
  onmessage: ((event: MessageEvent<SqliteReply>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(request: SqliteRequest, transfer?: Transferable[]): void
  terminate(): void
}

/** A request outlived its deadline; the worker was stopped and the database will reopen from the original bytes. */
export class SqliteTimeoutError extends Error {
  readonly timeoutMs: number
  constructor(timeoutMs: number, fromFile: boolean) {
    super(
      `Stopped after ${timeoutMs / 1000} s — the query was still running, so the SQLite worker was terminated. ` +
        (fromFile
          ? 'The database has been reopened from the original file: any unsaved changes in this tab were lost.'
          : 'The database has been reset to a new empty one: anything created in this tab was lost.'),
    )
    this.name = 'SqliteTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

type Args<K extends SqliteCall> = SqliteCalls[K]['args']
type Result<K extends SqliteCall> = SqliteCalls[K]['result']

interface Options {
  timeoutMs?: number
  openTimeoutMs?: number
}

/**
 * Serialises requests to one SQLite worker and kills it when a deadline
 * passes — the same guard as the regex tool: SQLite in wasm can't be
 * interrupted from outside, so terminating the whole worker is the only stop
 * for a recursive CTE without a LIMIT.
 *
 * The runner keeps the original bytes (never the worker's edited copy). After
 * a kill, the next request first reopens them in a fresh worker; the caller
 * gets a SqliteTimeoutError saying the edits are gone.
 */
export function createSqliteRunner(spawn: () => WorkerLike, options: Options = {}) {
  const timeoutMs = options.timeoutMs ?? QUERY_TIMEOUT_MS
  const openTimeoutMs = options.openTimeoutMs ?? OPEN_TIMEOUT_MS

  let worker: WorkerLike | null = null
  /** undefined: nothing opened yet. null: a new empty database. */
  let source: Uint8Array | null | undefined
  /** Whether the live worker holds `source` open. */
  let opened = false
  let nextId = 0
  let queue: Promise<unknown> = Promise.resolve()
  let disposed = false
  let pending: { id: number; resolve: (value: unknown) => void; reject: (error: Error) => void } | null = null

  const kill = () => {
    worker?.terminate()
    worker = null
    opened = false
  }

  const spawnWorker = () => {
    const w = spawn()
    w.onmessage = (event) => {
      const reply = event.data
      if (!pending || reply.id !== pending.id) return
      const { resolve, reject } = pending
      pending = null
      if (reply.ok) resolve(reply.value)
      else reject(new Error(reply.error))
    }
    w.onerror = () => {
      // An uncaught error or a wasm out-of-memory abort: the worker is unusable.
      const p = pending
      pending = null
      kill()
      p?.reject(new Error('The SQLite worker crashed — usually the browser ran out of memory for a large database. The database will reopen from the original file.'))
    }
    return w
  }

  function send<K extends SqliteCall>(type: K, args: Args<K>, ms: number): Promise<Result<K>> {
    const w = (worker ??= spawnWorker())
    const id = ++nextId
    return new Promise<Result<K>>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending?.id !== id) return
        pending = null
        kill()
        reject(new SqliteTimeoutError(ms, source instanceof Uint8Array))
      }, ms)
      pending = {
        id,
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value as Result<K>)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      }
      // The bytes are copied, not transferred: the runner keeps the original
      // to reopen from after a kill.
      w.postMessage({ id, type, ...args } as SqliteRequest)
    })
  }

  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.then(() => {
      if (disposed) throw new Error('The SQLite runner was closed.')
      return job()
    })
    queue = run.catch(() => undefined)
    return run
  }

  /** Opens `bytes` (or a new empty database for null), replacing whatever was open. */
  function open(bytes: Uint8Array | null): Promise<void> {
    return enqueue(async () => {
      source = undefined
      opened = false
      await send('open', { bytes }, openTimeoutMs)
      source = bytes
      opened = true
    })
  }

  function call<K extends Exclude<SqliteCall, 'open'>>(type: K, args: Args<K>, ms = timeoutMs): Promise<Result<K>> {
    return enqueue(async () => {
      if (source === undefined) throw new Error('No database is open.')
      if (!opened) {
        await send('open', { bytes: source }, openTimeoutMs)
        opened = true
      }
      return send(type, args, ms)
    })
  }

  function dispose() {
    disposed = true
    const p = pending
    pending = null
    kill()
    p?.reject(new Error('The SQLite runner was closed.'))
  }

  return { open, call, dispose }
}

export type SqliteRunner = ReturnType<typeof createSqliteRunner>

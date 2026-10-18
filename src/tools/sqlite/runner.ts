import type { ImportedTable, ImportJob, ImportProgress } from './importer'
import type { SqliteCall, SqliteCalls, SqliteReply, SqliteRequest } from './types'

/** How long one statement batch may run before the worker is stopped. */
export const QUERY_TIMEOUT_MS = 10_000
/** Opening parses nothing up front, but a large file still has to be copied into the wasm heap. */
export const OPEN_TIMEOUT_MS = 60_000
/**
 * An import is not held to the query deadline: it may run for minutes. It
 * reports progress between slices of inserts instead, and is only stopped
 * when it goes this long without a report — one file being parsed is the
 * longest silent stretch.
 */
export const IMPORT_STALL_MS = 60_000
/** Reading a data file to plan its table parses the whole file once. */
export const ANALYZE_TIMEOUT_MS = 120_000

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
  constructor(timeoutMs: number, fromFile: boolean, what: 'query' | 'import' = 'query') {
    super(
      (what === 'import'
        ? `Stopped: the import reported no progress for ${timeoutMs / 1000} s, so the SQLite worker was terminated. `
        : `Stopped after ${timeoutMs / 1000} s — the query was still running, so the SQLite worker was terminated. `) +
        (fromFile
          ? 'The database has been reopened from the original file: any unsaved changes in this tab were lost.'
          : 'The database has been reset to a new empty one: anything created in this tab was lost.'),
    )
    this.name = 'SqliteTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

/** The import was cancelled and rolled back — the database is as it was before. */
export class ImportCancelledError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportCancelledError'
  }
}

type Args<K extends SqliteCall> = SqliteCalls[K]['args']
type Result<K extends SqliteCall> = SqliteCalls[K]['result']

interface Options {
  timeoutMs?: number
  openTimeoutMs?: number
  importStallMs?: number
}

interface SendOptions {
  onProgress?: (progress: ImportProgress) => void
  /** The deadline restarts on every progress report instead of counting from the start. */
  stall?: boolean
  /** Aborting asks the worker to cancel (cooperatively — it stops at its next slice). */
  signal?: AbortSignal
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
  const importStallMs = options.importStallMs ?? IMPORT_STALL_MS

  let worker: WorkerLike | null = null
  /** undefined: nothing opened yet. null: a new empty database. */
  let source: Uint8Array | null | undefined
  /** Whether the live worker holds `source` open. */
  let opened = false
  let nextId = 0
  let queue: Promise<unknown> = Promise.resolve()
  let disposed = false
  let pending: {
    id: number
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    progress?: (progress: ImportProgress) => void
  } | null = null

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
      if ('progress' in reply) {
        pending.progress?.(reply.progress)
        return
      }
      const { resolve, reject } = pending
      pending = null
      if (reply.ok) resolve(reply.value)
      else reject(reply.cancelled ? new ImportCancelledError(reply.error) : new Error(reply.error))
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

  function send<K extends SqliteCall>(type: K, args: Args<K>, ms: number, opts: SendOptions = {}): Promise<Result<K>> {
    const w = (worker ??= spawnWorker())
    const id = ++nextId
    return new Promise<Result<K>>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const arm = () => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          if (pending?.id !== id) return
          pending = null
          kill()
          opts.signal?.removeEventListener('abort', onAbort)
          reject(new SqliteTimeoutError(ms, source instanceof Uint8Array, opts.stall ? 'import' : 'query'))
        }, ms)
      }
      const onAbort = () => {
        if (pending?.id === id) w.postMessage({ id, type: 'cancel' })
      }
      const settle = () => {
        clearTimeout(timer)
        opts.signal?.removeEventListener('abort', onAbort)
      }
      arm()
      pending = {
        id,
        resolve: (value) => {
          settle()
          resolve(value as Result<K>)
        },
        reject: (error) => {
          settle()
          reject(error)
        },
        progress: (progress) => {
          if (opts.stall) arm()
          opts.onProgress?.(progress)
        },
      }
      // The bytes are copied, not transferred: the runner keeps the original
      // to reopen from after a kill.
      w.postMessage({ id, type, ...args } as SqliteRequest)
      if (opts.signal) {
        if (opts.signal.aborted) onAbort()
        else opts.signal.addEventListener('abort', onAbort)
      }
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

  async function ensureOpen() {
    if (source === undefined) throw new Error('No database is open.')
    if (!opened) {
      await send('open', { bytes: source }, openTimeoutMs)
      opened = true
    }
  }

  function call<K extends Exclude<SqliteCall, 'open' | 'analyze' | 'import'>>(type: K, args: Args<K>, ms = timeoutMs): Promise<Result<K>> {
    return enqueue(async () => {
      await ensureOpen()
      return send(type, args, ms)
    })
  }

  /** Plans a data file's table. Works with or without an open database. */
  function analyze(args: Args<'analyze'>, ms = ANALYZE_TIMEOUT_MS) {
    return enqueue(() => send('analyze', args, ms))
  }

  /**
   * Imports into the open database. Rejects with ImportCancelledError when
   * `signal` aborts (the batch is rolled back), or SqliteTimeoutError when
   * the worker stops reporting progress for `importStallMs`.
   */
  function importData(
    jobs: ImportJob[],
    opts: { onProgress?: (progress: ImportProgress) => void; signal?: AbortSignal } = {},
  ): Promise<ImportedTable[]> {
    return enqueue(async () => {
      await ensureOpen()
      return send('import', { jobs }, importStallMs, { ...opts, stall: true })
    })
  }

  function dispose() {
    disposed = true
    const p = pending
    pending = null
    kill()
    p?.reject(new Error('The SQLite runner was closed.'))
  }

  return { open, call, analyze, importData, dispose }
}

export type SqliteRunner = ReturnType<typeof createSqliteRunner>

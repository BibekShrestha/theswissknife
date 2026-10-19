/**
 * Runs PDF Buddy's pdf-lib jobs in pdf.worker.ts and kills the worker when a
 * job goes quiet — the regex tool's deadline guard, with the exif tool's
 * queue in front and the sqlite import's stall rule: pdf-lib cannot be
 * interrupted from outside, so terminating the worker is the only stop for
 * a file built to hang it, and a long but healthy job (a 2,000-page
 * watermark) keeps reporting steps, each of which restarts its deadline.
 *
 * After a kill or a crash the next job gets a fresh worker. Bytes are
 * transferred both ways: the caller's input arrays are emptied by a run.
 */
import { PdfInputError } from './lib/errors'
import { jobLabels, transferList, type PdfJob, type PdfJobs, type PdfReply, type PdfRequest } from './protocol'

/**
 * How long a job may go without reporting a step. Steps come every couple
 * of thousand objects parsed and every page or file processed; the longest
 * silent stretch of a real file is pdf-lib writing it out.
 */
export const PDF_STALL_MS = 60_000

/** The subset of Worker the runner touches — lets tests drive it with a fake. */
export interface WorkerLike {
  onmessage: ((event: MessageEvent<PdfReply>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(request: PdfRequest, transfer: Transferable[]): void
  terminate(): void
}

/** setTimeout/clearTimeout; tests pass a virtual clock that advances with work done. */
export interface Timers {
  set(callback: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const realTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

const seconds = (ms: number) => (ms >= 1000 ? `${Math.round(ms / 1000)} s` : `${ms} ms`)

/** The job went quiet past its deadline; the worker was terminated. */
export class PdfTimeoutError extends PdfInputError {
  constructor(readonly job: PdfJob, readonly stallMs: number) {
    super(
      `${jobLabels[job]} stopped: the PDF worker made no progress for ${seconds(stallMs)}, so it was shut down. ` +
        'The file may be built to exhaust memory or time (a decompression bomb, a looping structure) or be too large for this device. ' +
        'Nothing was written — you can try again or choose another file.',
    )
    this.name = 'PdfTimeoutError'
  }
}

export class PdfCrashError extends PdfInputError {
  constructor(readonly job: PdfJob, offline = false) {
    super(
      offline
        ? `${jobLabels[job]} failed: the PDF worker could not start — this device is offline and the worker has not been downloaded yet. Run a PDF Buddy tool once while online to use it offline.`
        : `${jobLabels[job]} failed: the PDF worker crashed — usually the browser ran out of memory for this file. Nothing was written — you can try again or choose another file.`,
    )
    this.name = 'PdfCrashError'
  }
}

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

export interface RunOptions {
  /** Called with each progress value the job reports (Merge: files done). */
  onProgress?: (value: number) => void
}

export function createPdfRunner(spawn: () => WorkerLike, options: { stallMs?: number; timers?: Timers } = {}) {
  const stallMs = options.stallMs ?? PDF_STALL_MS
  const timers = options.timers ?? realTimers
  let worker: WorkerLike | null = null
  let nextId = 0
  let queue: Promise<unknown> = Promise.resolve()
  let disposed = false
  let pending: {
    id: number
    job: PdfJob
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    progress: (value?: number) => void
  } | null = null

  const kill = () => {
    worker?.terminate()
    worker = null
  }

  const spawnWorker = () => {
    const w = spawn()
    w.onmessage = (event) => {
      const reply = event.data
      if (!pending || reply.id !== pending.id) return
      if (reply.type === 'progress') {
        pending.progress(reply.value)
        return
      }
      const p = pending
      pending = null
      if (reply.type === 'done') p.resolve(reply.result)
      else p.reject(new PdfInputError(reply.message))
    }
    w.onerror = (event) => {
      event.preventDefault?.()
      const p = pending
      pending = null
      kill()
      p?.reject(new PdfCrashError(p.job, isOffline()))
    }
    return w
  }

  function send<K extends PdfJob>(job: K, args: PdfJobs[K]['args'], opts: RunOptions): Promise<PdfJobs[K]['result']> {
    const w = (worker ??= spawnWorker())
    const id = ++nextId
    return new Promise((resolve, reject) => {
      let timer: unknown
      const arm = () => {
        timers.clear(timer)
        timer = timers.set(() => {
          if (pending?.id !== id) return
          pending = null
          kill()
          reject(new PdfTimeoutError(job, stallMs))
        }, stallMs)
      }
      arm()
      pending = {
        id,
        job,
        resolve: (value) => {
          timers.clear(timer)
          resolve(value as PdfJobs[K]['result'])
        },
        reject: (error) => {
          timers.clear(timer)
          reject(error)
        },
        progress: (value) => {
          arm()
          if (value !== undefined) opts.onProgress?.(value)
        },
      }
      const request = { id, job, args } as PdfRequest
      w.postMessage(request, transferList(args))
    })
  }

  /** Queues one job; jobs run in the order they were queued. */
  function run<K extends PdfJob>(job: K, args: PdfJobs[K]['args'], opts: RunOptions = {}): Promise<PdfJobs[K]['result']> {
    const result = queue.then(() => {
      if (disposed) throw new PdfInputError('The PDF worker was closed.')
      return send(job, args, opts)
    })
    queue = result.catch(() => undefined)
    return result
  }

  function dispose() {
    disposed = true
    const p = pending
    pending = null
    kill()
    p?.reject(new PdfInputError('The PDF worker was closed.'))
  }

  return { run, dispose }
}

export type PdfRunner = ReturnType<typeof createPdfRunner>

let shared: PdfRunner | null = null

/** The page's one PDF worker, spawned on the first job. */
export function runPdfJob<K extends PdfJob>(job: K, args: PdfJobs[K]['args'], opts?: RunOptions): Promise<PdfJobs[K]['result']> {
  shared ??= createPdfRunner(() => new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module' }))
  return shared.run(job, args, opts)
}

/** Stops the worker when PDF Buddy is left; the next job spawns a new one. */
export function closePdfRunner(): void {
  shared?.dispose()
  shared = null
}

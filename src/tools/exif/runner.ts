import type { Processed, StripOptions } from './lib/types'
import type { ExifReply, ExifRequest } from './protocol'

/** Per file. Parsing is linear; this only trips on a file built to make a parser spin, or a huge one on a slow device. */
export const PROCESS_TIMEOUT_MS = 20_000

/** The subset of Worker the runner touches — lets tests drive it with a fake. */
export interface WorkerLike {
  onmessage: ((event: MessageEvent<ExifReply>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(request: ExifRequest, transfer?: Transferable[]): void
  terminate(): void
}

export class ExifTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Stopped after ${timeoutMs / 1000} s — the file kept the parser busy too long, so its worker was terminated. Nothing was written.`)
    this.name = 'ExifTimeoutError'
  }
}

/**
 * Runs one file at a time in a worker and kills the worker when a deadline
 * passes — the regex tool's guard, with a queue in front because a batch is
 * many files. After a kill or a crash the next file gets a fresh worker.
 */
export function createExifRunner(spawn: () => WorkerLike, timeoutMs = PROCESS_TIMEOUT_MS) {
  let worker: WorkerLike | null = null
  let nextId = 0
  let queue: Promise<unknown> = Promise.resolve()
  let disposed = false
  let pending: { id: number; resolve: (value: Processed) => void; reject: (error: Error) => void } | null = null

  const kill = () => {
    worker?.terminate()
    worker = null
  }

  const spawnWorker = () => {
    const w = spawn()
    w.onmessage = (event) => {
      const reply = event.data
      if (!pending || reply.id !== pending.id) return
      const { resolve, reject } = pending
      pending = null
      if (reply.ok) resolve(reply.result)
      else reject(new Error(reply.error))
    }
    w.onerror = () => {
      const p = pending
      pending = null
      kill()
      p?.reject(new Error('The parser worker crashed — usually the browser ran out of memory for a very large file.'))
    }
    return w
  }

  function send(bytes: Uint8Array<ArrayBuffer>, options: StripOptions): Promise<Processed> {
    const w = (worker ??= spawnWorker())
    const id = ++nextId
    return new Promise<Processed>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending?.id !== id) return
        pending = null
        kill()
        reject(new ExifTimeoutError(timeoutMs))
      }, timeoutMs)
      pending = {
        id,
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      }
      // Transferred, not copied: the caller re-reads the File when it needs the bytes again.
      w.postMessage({ id, bytes, options }, [bytes.buffer])
    })
  }

  /** Queues one file; files run in the order they were queued. */
  function process(bytes: Uint8Array<ArrayBuffer>, options: StripOptions): Promise<Processed> {
    const run = queue.then(() => {
      if (disposed) throw new Error('The metadata runner was closed.')
      return send(bytes, options)
    })
    queue = run.catch(() => undefined)
    return run
  }

  function dispose() {
    disposed = true
    const p = pending
    pending = null
    kill()
    p?.reject(new Error('The metadata runner was closed.'))
  }

  return { process, dispose }
}

export type ExifRunner = ReturnType<typeof createExifRunner>

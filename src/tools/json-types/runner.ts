import type { InferOptions, InferResult } from './engine'

/** Long enough for tens of megabytes of JSON; a run past it is stopped, not waited on. */
export const INFER_TIMEOUT_MS = 15_000

export interface InferRequest {
  id: number
  text: string
  options: InferOptions
}

export interface InferReply {
  id: number
  result: InferResult
  elapsedMs: number
}

/** The subset of Worker the runner touches — lets tests drive it with a fake. */
export interface WorkerLike {
  onmessage: ((event: MessageEvent<InferReply>) => void) | null
  postMessage(request: InferRequest): void
  terminate(): void
}

export type RunOutcome = { result: InferResult; elapsedMs: number } | { stopped: true; timeoutMs: number }

/**
 * Runs each inference in a worker and kills it when the deadline passes — a
 * huge paste can't be interrupted from inside JSON.parse, so the whole worker
 * goes and the next request gets a fresh one (copied from the regex tool's
 * runner).
 *
 * Only the latest request matters: starting a new one abandons the previous
 * (terminating its worker if it was still busy), and its promise never settles.
 */
export function createInferRunner(spawn: () => WorkerLike, timeoutMs = INFER_TIMEOUT_MS) {
  let worker: WorkerLike | null = null
  let busy = false
  let nextId = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const kill = () => {
    worker?.terminate()
    worker = null
    busy = false
  }

  function run(text: string, options: InferOptions): Promise<RunOutcome> {
    clearTimeout(timer)
    if (busy) kill()
    const id = ++nextId
    const w = (worker ??= spawn())
    busy = true

    return new Promise((resolve) => {
      w.onmessage = (event) => {
        if (event.data.id !== id) return
        clearTimeout(timer)
        busy = false
        resolve({ result: event.data.result, elapsedMs: event.data.elapsedMs })
      }
      timer = setTimeout(() => {
        kill()
        resolve({ stopped: true, timeoutMs })
      }, timeoutMs)
      w.postMessage({ id, text, options })
    })
  }

  function dispose() {
    clearTimeout(timer)
    kill()
  }

  return { run, dispose }
}

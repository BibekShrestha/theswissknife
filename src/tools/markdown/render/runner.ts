import type { Counts, RenderReply, RenderRequest } from './job'
import type { RenderResult } from './render'

/**
 * Runs renders in a worker and kills it when a deadline passes — the same
 * pattern as the regex tool's runner (copied, not imported: tools stay
 * self-contained). A render stuck inside marked cannot be interrupted from
 * within, so terminating the worker is the only guard; the next render gets a
 * fresh one.
 *
 * Unlike regex matching, a render that is already running is allowed to
 * finish — its result is newer than what the preview shows, and killing it on
 * every keystroke would starve a long document. Requests that arrive
 * meanwhile wait; only the latest of them runs next, and the ones it replaces
 * resolve to null.
 */

/** The subset of Worker the runner touches — lets tests drive it with a fake. */
export interface RenderWorkerLike {
  onmessage: ((event: MessageEvent<RenderReply>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(request: RenderRequest): void
  terminate(): void
}

export type RenderOutcome =
  | { ok: true, result: RenderResult, counts: Counts }
  | { ok: false, timedOut: boolean, message: string }

export const RENDER_TIMEOUT_MS = 4000

const tooLong = (timeoutMs: number) =>
  `Rendering took too long (stopped after ${timeoutMs / 1000} s). Something in this document makes the Markdown parser very slow — long runs of unclosed brackets or emphasis markers are the usual cause.`

interface Job {
  request: Omit<RenderRequest, 'id'>
  resolve: (outcome: RenderOutcome | null) => void
}

export function createRenderRunner(spawn: () => RenderWorkerLike, timeoutMs = RENDER_TIMEOUT_MS) {
  let worker: RenderWorkerLike | null = null
  let running: Job | null = null
  let waiting: Job | null = null
  let nextId = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const kill = () => {
    worker?.terminate()
    worker = null
  }

  const finish = (outcome: RenderOutcome) => {
    clearTimeout(timer)
    const job = running
    running = null
    job?.resolve(outcome)
    const next = waiting
    waiting = null
    if (next) start(next)
  }

  function start(job: Job) {
    running = job
    const id = ++nextId
    const w = (worker ??= spawn())
    w.onmessage = (event) => {
      const reply = event.data
      if (reply.id !== id) return
      finish(reply.ok ? { ok: true, result: reply.result, counts: reply.counts } : { ok: false, timedOut: false, message: reply.message })
    }
    w.onerror = (event) => {
      kill()
      finish({ ok: false, timedOut: false, message: event.message || 'The Markdown renderer stopped unexpectedly.' })
    }
    timer = setTimeout(() => {
      kill()
      finish({ ok: false, timedOut: true, message: tooLong(timeoutMs) })
    }, timeoutMs)
    w.postMessage({ ...job.request, id })
  }

  function run(request: Omit<RenderRequest, 'id'>): Promise<RenderOutcome | null> {
    return new Promise((resolve) => {
      const job = { request, resolve }
      if (!running) return start(job)
      waiting?.resolve(null)
      waiting = job
    })
  }

  function dispose() {
    clearTimeout(timer)
    kill()
    running = null
    waiting = null
  }

  return { run, dispose }
}

import type { InspectReply, InspectRequest, InspectResult } from './job'

/**
 * Runs inspections in a worker with a deadline — the markdown tool's runner
 * pattern (copied, not imported: tools stay self-contained). The scan is
 * linear, but a huge paste on a slow device could still run long; past the
 * deadline the worker is terminated and the next request gets a fresh one.
 *
 * A running request finishes; requests that arrive meanwhile wait, and only
 * the latest of them runs next (the ones it replaces resolve to null).
 */

export interface InspectWorkerLike {
  onmessage: ((event: MessageEvent<InspectReply>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(request: InspectRequest): void
  terminate(): void
}

export type InspectOutcome = { ok: true, result: InspectResult } | { ok: false, timedOut: boolean, message: string }

export const INSPECT_TIMEOUT_MS = 20000

interface Job {
  request: Omit<InspectRequest, 'id'>
  resolve: (outcome: InspectOutcome | null) => void
}

export function createInspectRunner(spawn: () => InspectWorkerLike, timeoutMs = INSPECT_TIMEOUT_MS) {
  let worker: InspectWorkerLike | null = null
  let running: Job | null = null
  let waiting: Job | null = null
  let nextId = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const kill = () => {
    worker?.terminate()
    worker = null
  }

  const finish = (outcome: InspectOutcome) => {
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
      finish(reply.ok ? { ok: true, result: reply.result } : { ok: false, timedOut: false, message: reply.message })
    }
    w.onerror = (event) => {
      kill()
      finish({ ok: false, timedOut: false, message: event.message || 'The inspector stopped unexpectedly.' })
    }
    timer = setTimeout(() => {
      kill()
      finish({ ok: false, timedOut: true, message: `The text took longer than ${timeoutMs / 1000} s to inspect, so it was stopped. Try a smaller piece.` })
    }, timeoutMs)
    w.postMessage({ ...job.request, id })
  }

  function run(request: Omit<InspectRequest, 'id'>): Promise<InspectOutcome | null> {
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
    waiting?.resolve(null)
    waiting = null
  }

  return { run, dispose }
}

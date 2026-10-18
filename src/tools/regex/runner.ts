import type { RegexRequest, RegexResult, RegexWorkerMessage, TestsRequest, TestsResult } from './types'

/** The subset of Worker the runner touches — lets tests drive it with a fake. */
export interface WorkerLike {
  onmessage: ((event: MessageEvent<RegexWorkerMessage>) => void) | null
  postMessage(request: RegexRequest | TestsRequest): void
  terminate(): void
}

const stoppedMessage = (timeoutMs: number) =>
  `Stopped after ${timeoutMs / 1000} s — this pattern backtracks catastrophically on this input. Simplify the pattern (nested quantifiers like (a+)+ are the usual cause).`

/**
 * Runs each request in a worker and kills it when the deadline passes. A
 * pattern that backtracks catastrophically cannot be interrupted from inside
 * the regex engine, so terminating the whole worker is the only guard — the
 * next request gets a fresh one.
 *
 * Only the latest request matters: starting a new one abandons the previous
 * (terminating its worker if it was still busy), and its promise never settles.
 */
function createDeadlineRunner<Req extends { id: number }, Res>(
  spawn: () => WorkerLike,
  timeoutMs: number,
  type: RegexWorkerMessage['type'],
  onTimeout: () => Res,
) {
  let worker: WorkerLike | null = null
  let busy = false
  let nextId = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const kill = () => {
    worker?.terminate()
    worker = null
    busy = false
  }

  function run(request: Omit<Req, 'id'>): Promise<Res> {
    clearTimeout(timer)
    if (busy) kill()
    const id = ++nextId
    const w = (worker ??= spawn())
    busy = true

    return new Promise((resolve) => {
      w.onmessage = (event) => {
        const message = event.data
        if (message.type !== type || message.id !== id) return
        clearTimeout(timer)
        busy = false
        resolve(message.result as Res)
      }
      timer = setTimeout(() => {
        kill()
        resolve(onTimeout())
      }, timeoutMs)
      w.postMessage({ ...request, id } as unknown as RegexRequest | TestsRequest)
    })
  }

  function dispose() {
    clearTimeout(timer)
    kill()
  }

  return { run, dispose }
}

export function createRegexRunner(spawn: () => WorkerLike, timeoutMs: number) {
  return createDeadlineRunner<RegexRequest, RegexResult>(spawn, timeoutMs, 'result', () => ({
    engine: 'javascript',
    version: 'ECMAScript',
    matches: [],
    replacement: null,
    elapsedMs: timeoutMs,
    error: stoppedMessage(timeoutMs),
    truncated: false,
  }))
}

/** The Tests tab's runner: same deadline, its own worker. */
export function createTestsRunner(spawn: () => WorkerLike, timeoutMs: number) {
  return createDeadlineRunner<TestsRequest, TestsResult>(spawn, timeoutMs, 'tests', () => ({
    results: [],
    elapsedMs: timeoutMs,
    error: stoppedMessage(timeoutMs),
  }))
}

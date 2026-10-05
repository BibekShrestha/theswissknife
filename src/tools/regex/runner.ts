import type { RegexRequest, RegexResult, RegexWorkerMessage } from './types'

/** The subset of Worker the runner touches — lets tests drive it with a fake. */
export interface WorkerLike {
  onmessage: ((event: MessageEvent<RegexWorkerMessage>) => void) | null
  postMessage(request: RegexRequest): void
  terminate(): void
}

/**
 * Runs each request in a worker and kills it when the deadline passes. A
 * pattern that backtracks catastrophically cannot be interrupted from inside
 * the regex engine, so terminating the whole worker is the only guard — the
 * next request gets a fresh one.
 *
 * Only the latest request matters: starting a new one abandons the previous
 * (terminating its worker if it was still busy), and its promise never settles.
 */
export function createRegexRunner(spawn: () => WorkerLike, timeoutMs: number) {
  let worker: WorkerLike | null = null
  let busy = false
  let nextId = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const kill = () => {
    worker?.terminate()
    worker = null
    busy = false
  }

  function run(request: Omit<RegexRequest, 'id'>): Promise<RegexResult> {
    clearTimeout(timer)
    if (busy) kill()
    const id = ++nextId
    const w = (worker ??= spawn())
    busy = true

    return new Promise((resolve) => {
      w.onmessage = (event) => {
        const message = event.data
        if (message.type !== 'result' || message.id !== id) return
        clearTimeout(timer)
        busy = false
        resolve(message.result)
      }
      timer = setTimeout(() => {
        kill()
        resolve({
          engine: 'javascript',
          version: 'ECMAScript',
          matches: [],
          replacement: null,
          elapsedMs: timeoutMs,
          error: `Stopped after ${timeoutMs / 1000} s — this pattern backtracks catastrophically on this subject. Simplify the pattern (nested quantifiers like (a+)+ are the usual cause).`,
          truncated: false,
        })
      }, timeoutMs)
      w.postMessage({ ...request, id })
    })
  }

  function dispose() {
    clearTimeout(timer)
    kill()
  }

  return { run, dispose }
}

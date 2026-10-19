import type { DiffReply, DiffRequest } from './types'

export const DIFF_TIMEOUT_MS = 8000

/** The subset of Worker the runner touches — lets tests drive it with a fake. */
export interface WorkerLike {
  onmessage: ((event: MessageEvent<DiffReply>) => void) | null
  postMessage(request: DiffRequest): void
  terminate(): void
}

/**
 * Runs each comparison in a worker and kills it when the deadline passes.
 * Myers is O(ND): large files with many scattered changes can take minutes,
 * and a running loop cannot be interrupted from outside — so the whole worker
 * goes, and the next request gets a fresh one.
 *
 * Only the latest request matters: starting a new one abandons the previous
 * (terminating its worker if it was still busy), and its promise never settles.
 */
export function createDiffRunner(spawn: () => WorkerLike, timeoutMs = DIFF_TIMEOUT_MS) {
  let worker: WorkerLike | null = null
  let busy = false
  let nextId = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const kill = () => {
    worker?.terminate()
    worker = null
    busy = false
  }

  function run(request: Omit<DiffRequest, 'id'>): Promise<Omit<DiffReply, 'id'>> {
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
        resolve(event.data)
      }
      timer = setTimeout(() => {
        kill()
        resolve({
          elapsedMs: timeoutMs,
          result: { error: `Stopped after ${timeoutMs / 1000} s — these inputs are too large, or differ in too many places, to diff within the time limit. Trim them to the part that changed and try again.` },
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

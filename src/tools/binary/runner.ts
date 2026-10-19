import { emptyResult, type DecodeRequest, type DecodeResponse, type WorkerMessage } from './types'

/** The subset of Worker the runner touches — lets tests drive it with a fake. */
export interface WorkerLike {
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null
  postMessage(request: DecodeRequest): void
  terminate(): void
}

/**
 * Runs each decode in a worker and kills it when the deadline passes — the
 * regex tool's runner, copied. A decoder stuck on hostile input cannot be
 * interrupted from inside, so terminating the worker is the only guard; the
 * next request gets a fresh one.
 *
 * Only the latest request matters: starting a new one abandons the previous
 * (terminating its worker if it was still busy), and its promise never settles.
 */
export function createDecodeRunner(spawn: () => WorkerLike, timeoutMs: number) {
  let worker: WorkerLike | null = null
  let busy = false
  let nextId = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const kill = () => {
    worker?.terminate()
    worker = null
    busy = false
  }

  function run(request: Omit<DecodeRequest, 'id'>): Promise<DecodeResponse> {
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
          result: emptyResult(request.format === 'auto' ? 'protobuf' : request.format),
          detection: null,
          schema: null,
          error: `Stopped after ${timeoutMs / 1000} s — decoding this input took too long. Try a specific format, or a smaller input.`,
          elapsedMs: timeoutMs,
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

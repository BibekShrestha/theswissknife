import type { ConvertResult, DxfToKmlOptions, KmlToDxfOptions } from './convert'

/** Long enough for a drawing of a few hundred megabytes; a run past it is stopped, not waited on. */
export const CONVERT_TIMEOUT_MS = 60_000

export type Job =
  | { direction: 'kml-to-dxf'; options: KmlToDxfOptions }
  | { direction: 'dxf-to-kml'; options: DxfToKmlOptions }

export interface ConvertRequest {
  id: number
  /** Identifies the file, so the worker can keep its parsed DXF between option changes. */
  fileId: number
  name: string
  bytes: Uint8Array<ArrayBuffer>
  job: Job
}

export interface ConvertReply {
  id: number
  result: ConvertResult
  elapsedMs: number
}

/** The subset of Worker the runner touches — lets tests drive it with a fake. */
export interface WorkerLike {
  onmessage: ((event: MessageEvent<ConvertReply>) => void) | null
  postMessage(request: ConvertRequest): void
  terminate(): void
}

export type RunOutcome = { result: ConvertResult; elapsedMs: number } | { stopped: true; timeoutMs: number }

/**
 * Runs each conversion in a worker and kills it when the deadline passes —
 * a pathological file can't be interrupted from inside the parser, so the
 * whole worker goes and the next request gets a fresh one (copied from the
 * json-types runner).
 *
 * Only the latest request matters: starting a new one abandons the previous
 * (terminating its worker if it was still busy), and its promise never settles.
 */
export function createConvertRunner(spawn: () => WorkerLike, timeoutMs = CONVERT_TIMEOUT_MS) {
  let worker: WorkerLike | null = null
  let busy = false
  let nextId = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const kill = () => {
    worker?.terminate()
    worker = null
    busy = false
  }

  function run(fileId: number, name: string, bytes: Uint8Array<ArrayBuffer>, job: Job): Promise<RunOutcome> {
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
      w.postMessage({ id, fileId, name, bytes, job })
    })
  }

  function dispose() {
    clearTimeout(timer)
    kill()
  }

  return { run, dispose }
}

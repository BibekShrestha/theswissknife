/**
 * Runs the pattern sweep in a worker and kills it when the deadline passes —
 * the same guard as /regex's runner.ts (copied, not imported: tools stay
 * self-contained). A pattern that backtracks catastrophically cannot be
 * interrupted from inside the regex engine, and patterns here come from the
 * user or from a shared link, so terminating the worker is the only guard.
 *
 * Only the latest request matters: starting a new one abandons the previous
 * (terminating its worker if it was still busy), and its promise never settles.
 */

import type { MatchReport, Target } from './redact'

/** How long one sweep over the text may take before it is stopped. */
export const MATCH_TIMEOUT_MS = 2_000

export interface MatchRequest {
  id: number
  text: string
  targets: Target[]
  caseSensitive: boolean
}

export type MatchWorkerMessage =
  /** Sent before each target is tried, so a timeout can name the one that hung. */
  | { type: 'progress'; id: number; index: number }
  | { type: 'result'; id: number; report: MatchReport }

export type MatchOutcome =
  | { timedOut: false; report: MatchReport }
  /** `culprit`: index of the target that was running when time ran out. */
  | { timedOut: true; culprit: number | null }

/** The subset of Worker the runner touches — lets tests drive it with a fake. */
export interface WorkerLike {
  onmessage: ((event: MessageEvent<MatchWorkerMessage>) => void) | null
  postMessage(request: MatchRequest): void
  terminate(): void
}

export function createMatchRunner(spawn: () => WorkerLike, timeoutMs: number) {
  let worker: WorkerLike | null = null
  let busy = false
  let nextId = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const kill = () => {
    worker?.terminate()
    worker = null
    busy = false
  }

  function run(request: Omit<MatchRequest, 'id'>): Promise<MatchOutcome> {
    clearTimeout(timer)
    if (busy) kill()
    const id = ++nextId
    const w = (worker ??= spawn())
    busy = true
    let culprit: number | null = null

    return new Promise((resolve) => {
      w.onmessage = (event) => {
        const message = event.data
        if (message.id !== id) return
        if (message.type === 'progress') {
          culprit = message.index
          return
        }
        clearTimeout(timer)
        busy = false
        resolve({ timedOut: false, report: message.report })
      }
      timer = setTimeout(() => {
        kill()
        resolve({ timedOut: true, culprit })
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

export type MatchRunner = ReturnType<typeof createMatchRunner>

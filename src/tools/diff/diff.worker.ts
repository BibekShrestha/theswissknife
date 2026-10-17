/**
 * Diff worker — keeps large comparisons off the main thread. The runner
 * (runner.ts) owns the deadline: if no reply arrives in time it terminates
 * this worker.
 */

import { computeDiff } from './compute'
import type { DiffReply, DiffRequest } from './types'

self.onmessage = (event: MessageEvent<DiffRequest>) => {
  const { id, left, right, options } = event.data
  const started = performance.now()
  let result: DiffReply['result']
  try {
    result = computeDiff(left, right, options)
  } catch (error) {
    result = { error: `Diff failed: ${(error as Error).message}` }
  }
  const reply: DiffReply = { id, result, elapsedMs: performance.now() - started }
  self.postMessage(reply)
}

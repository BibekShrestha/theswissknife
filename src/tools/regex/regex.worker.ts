/**
 * Regex worker — runs user-supplied patterns off the main thread so ReDoS
 * (catastrophic backtracking) cannot freeze the UI. The runner (runner.ts)
 * owns the deadline: if no reply arrives in time it terminates this worker.
 * Matching and the Tests tab use separate runners, so each gets its own
 * worker and a slow one cannot abandon the other.
 */

import { evaluateJavascript, evaluateTests } from './javascript'
import type { RegexRequest, RegexWorkerMessage, TestsRequest } from './types'

self.onmessage = (event: MessageEvent<RegexRequest | TestsRequest>) => {
  const request = event.data
  const message: RegexWorkerMessage = request.kind === 'tests'
    ? { type: 'tests', id: request.id, result: evaluateTests(request) }
    : { type: 'result', id: request.id, result: evaluateJavascript(request) }
  self.postMessage(message)
}

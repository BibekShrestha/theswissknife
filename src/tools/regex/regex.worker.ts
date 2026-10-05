/**
 * Regex worker — runs user-supplied patterns off the main thread so ReDoS
 * (catastrophic backtracking) cannot freeze the UI. The runner (runner.ts)
 * owns the deadline: if no reply arrives in time it terminates this worker.
 */

import { evaluateJavascript } from './javascript'
import type { RegexRequest, RegexWorkerMessage } from './types'

self.onmessage = (event: MessageEvent<RegexRequest>) => {
  const message: RegexWorkerMessage = { type: 'result', id: event.data.id, result: evaluateJavascript(event.data) }
  self.postMessage(message)
}

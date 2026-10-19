/**
 * Match worker — runs the redaction targets off the main thread so a pattern
 * that backtracks catastrophically, typed or arriving in a #p= link, cannot
 * freeze the tab. The runner (runner.ts) owns the deadline: if no reply
 * arrives in time it terminates this worker.
 */

import { findRanges } from './redact'
import type { MatchRequest, MatchWorkerMessage } from './runner'

self.onmessage = (event: MessageEvent<MatchRequest>) => {
  const { id, text, targets, caseSensitive } = event.data
  const report = findRanges(text, targets, {
    caseSensitive,
    onTarget: (index) => self.postMessage({ type: 'progress', id, index } satisfies MatchWorkerMessage),
  })
  self.postMessage({ type: 'result', id, report } satisfies MatchWorkerMessage)
}

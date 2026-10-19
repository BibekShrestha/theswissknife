/**
 * Inference worker: parsing and walking a large or deeply nested paste runs
 * here so the page stays responsive. runner.ts owns the deadline and
 * terminates this worker if a run takes too long. engine.ts caches the last
 * input's Shape, so option changes don't re-read it.
 */

import { runInference } from './engine'
import type { InferReply, InferRequest } from './runner'

self.onmessage = (event: MessageEvent<InferRequest>) => {
  const { id, text, options } = event.data
  const started = performance.now()
  let reply: InferReply
  try {
    reply = { id, result: runInference(text, options), elapsedMs: performance.now() - started }
  } catch (error) {
    // Out of memory or stack on a pathological input: say so instead of leaving the page waiting.
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    reply = { id, result: { ok: false, error: { message, sample: 0 } }, elapsedMs: performance.now() - started }
  }
  self.postMessage(reply)
}

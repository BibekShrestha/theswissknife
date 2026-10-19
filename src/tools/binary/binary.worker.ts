/**
 * Decoder worker — untrusted bytes are decoded off the main thread. The
 * runner (runner.ts) owns the deadline: if no reply arrives in time it
 * terminates this worker and the next decode gets a fresh one.
 */

import { handleDecode } from './decode'
import type { DecodeRequest, WorkerMessage } from './types'

self.onmessage = (event: MessageEvent<DecodeRequest>) => {
  const request = event.data
  const message: WorkerMessage = { type: 'result', id: request.id, result: handleDecode(request) }
  self.postMessage(message)
}

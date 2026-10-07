/**
 * Scan worker — jsQR walks every pixel, which on a large photo takes long
 * enough to stall typing. The runner (decode.ts) owns the deadline and
 * terminates this worker if a pass never returns.
 */

import { decodePixels } from './engine'
import type { ScanReply, ScanRequest } from './decode'

self.onmessage = (event: MessageEvent<ScanRequest>) => {
  const { id, data, width, height } = event.data
  const reply: ScanReply = { id, found: decodePixels(data, width, height) }
  self.postMessage(reply)
}

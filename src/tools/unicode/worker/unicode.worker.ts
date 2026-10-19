/**
 * Unicode inspector worker: the scan, the grapheme pages and the normalised
 * and cleaned outputs all run here, so a multi-megabyte paste never blocks
 * typing. The names table is a separate chunk, imported on the first request
 * (and runtime-cached by the service worker from then on).
 */

import { createJob, type InspectRequest } from './job'

const run = createJob(() => import('../names/names'))

self.onmessage = async (event: MessageEvent<InspectRequest>) => {
  self.postMessage(await run(event.data))
}

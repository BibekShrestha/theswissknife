/**
 * Image worker — decoding, resizing and encoding all happen here so a 40 MP
 * photo (or a GIF quantisation pass, which is pure JS) cannot freeze the page.
 *
 * One job at a time by design: several full-size bitmaps in flight is how you
 * get a browser to kill the tab. The page terminates this worker to cancel.
 */

import { decodeRaster } from './lib/decode'
import { runJob, type WorkerRequest, type WorkerResponse } from './lib/job'

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, bitmap, blob, options } = event.data
  let decoded: ImageBitmap | null = null
  try {
    decoded = bitmap ?? (await decodeRaster(blob!))
    const output = await runJob(decoded, options)
    const response: WorkerResponse = { id, ok: true, output }
    self.postMessage(response)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const response: WorkerResponse = { id, ok: false, message: friendly(message) }
    self.postMessage(response)
  } finally {
    decoded?.close()
  }
}

function friendly(message: string): string {
  if (/decode|source image|unsupported|invalid/i.test(message)) {
    return 'This file could not be decoded as an image'
  }
  if (/memory|allocation/i.test(message)) {
    return 'Ran out of memory on this image — try a smaller output size'
  }
  return message
}

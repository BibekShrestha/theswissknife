/**
 * Parses and strips one file per request, off the main thread. runner.ts owns
 * the deadline: a malformed file that sends a parser into a long walk costs
 * an error message and a fresh worker, not a frozen tab.
 */
import { processImage } from './lib/analyze'
import type { ExifReply, ExifRequest } from './protocol'

self.onmessage = async (event: MessageEvent<ExifRequest>) => {
  const { id, bytes, options } = event.data
  let reply: ExifReply
  const transfer: Transferable[] = []
  try {
    const result = await processImage(bytes, options)
    reply = { id, ok: true, result }
    transfer.push(result.bytes.buffer)
  } catch (error) {
    reply = { id, ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  self.postMessage(reply, { transfer })
}

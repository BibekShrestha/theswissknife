/**
 * Conversion worker: parsing, projecting and writing run here so the page
 * stays responsive. runner.ts owns the deadline and terminates this worker
 * if a run takes too long. convert.ts keeps the last parsed DXF, so changing
 * the coordinate system doesn't re-read the file.
 */

import { dxfToKml, kmlToDxf } from './convert'
import type { ConvertReply, ConvertRequest } from './runner'

self.onmessage = async (event: MessageEvent<ConvertRequest>) => {
  const { id, fileId, name, bytes, job } = event.data
  const started = performance.now()
  let reply: ConvertReply
  try {
    const result = job.direction === 'kml-to-dxf'
      ? await kmlToDxf(name, bytes, job.options)
      : await dxfToKml(name, bytes, job.options, String(fileId))
    reply = { id, result, elapsedMs: performance.now() - started }
  } catch (error) {
    // Out of memory or stack on a pathological file: say so instead of leaving the page waiting.
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    reply = { id, result: { ok: false, error: message }, elapsedMs: performance.now() - started }
  }
  const data = reply.result.ok ? reply.result.summary.output?.data : undefined
  self.postMessage(reply, { transfer: data instanceof Uint8Array ? [data.buffer] : [] })
}

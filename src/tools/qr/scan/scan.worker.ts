/**
 * Scan worker — the decoders walk every pixel and can take seconds on a large
 * photo. The runner (decode.ts) owns the deadline and terminates this worker
 * if a pass never returns.
 */

import { prepareZXingModule } from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import { decodeWechat, decodeZxing } from './engine'
import type { ScanReply, ScanRequest } from './decode'

// Serve the wasm from this site. Left alone, zxing-wasm fetches it from a CDN.
prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? new URL(wasmUrl, self.location.href).href : prefix + path),
  },
})

self.onmessage = async (event: MessageEvent<ScanRequest>) => {
  const { id, engine, data, width, height } = event.data
  let reply: ScanReply
  try {
    const pixels = { data, width, height }
    reply = { id, found: engine === 'zxing' ? await decodeZxing(pixels) : await decodeWechat(pixels) }
  } catch (e) {
    reply = { id, found: [], error: (e as Error).message || 'The decoder failed on this image' }
  }
  self.postMessage(reply)
}

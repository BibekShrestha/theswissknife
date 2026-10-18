/**
 * QR decoding off the main thread: ZXing walks every pixel and can take
 * seconds on a large photo. scan.ts owns the deadline and terminates this
 * worker if a decode never returns.
 */

import { prepareZXingModule } from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import { readQrTexts } from './reader'
import type { ScanReply, ScanRequest } from './scan'

// Serve the wasm from this site. Left alone, zxing-wasm fetches it from a CDN.
prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? new URL(wasmUrl, self.location.href).href : prefix + path),
  },
})

self.onmessage = async (event: MessageEvent<ScanRequest>) => {
  const { id, data, width, height } = event.data
  let reply: ScanReply
  try {
    reply = { id, texts: await readQrTexts({ data, width, height }) }
  } catch (e) {
    reply = { id, texts: [], error: (e as Error).message || 'The decoder failed on this image' }
  }
  self.postMessage(reply)
}

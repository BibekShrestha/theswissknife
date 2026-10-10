/**
 * Test-only helpers. The worker's ?url import names a path Node cannot
 * fetch, so ZXing gets its wasm bytes from disk; getBuiltinModule (Node
 * 22.3+) reads them without pulling Node's types into the app.
 */

import { prepareZXingModule } from 'zxing-wasm/reader'
import { WECHAT_RETRY_EDGES } from './decode'
import { decodeWechat, decodeZxing, type Found, type Pixels } from './engine'

const { readFileSync } = (globalThis as unknown as {
  process: { getBuiltinModule(id: 'node:fs'): { readFileSync(path: URL): Uint8Array } }
}).process.getBuiltinModule('node:fs')

const wasm = readFileSync(new URL('../../../../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm', import.meta.url))
prepareZXingModule({ overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer } })

export const readFixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url))

/** Box-filtered copy with a long edge of `edge`, standing in for the canvas `decode.ts` draws. */
export function shrink(p: Pixels, edge: number): Pixels & { kx: number; ky: number } {
  const k = Math.min(1, edge / Math.max(p.width, p.height))
  const width = Math.max(1, Math.round(p.width * k)), height = Math.max(1, Math.round(p.height * k))
  const kx = width / p.width, ky = height / p.height
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y / ky), y1 = Math.max(y0 + 1, Math.floor((y + 1) / ky))
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x / kx), x1 = Math.max(x0 + 1, Math.floor((x + 1) / kx))
      for (let c = 0; c < 4; c++) {
        let sum = 0
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) sum += p.data[(yy * p.width + xx) * 4 + c]
        data[(y * width + x) * 4 + c] = sum / ((y1 - y0) * (x1 - x0))
      }
    }
  }
  return { data, width, height, kx, ky }
}

/** The order `decode.ts` runs them in, minus the browser's BarcodeDetector (Node has none): WeChat only when ZXing finds nothing, then on smaller copies. */
export async function readCodes(pixels: Pixels): Promise<{ engine: 'zxing' | 'wechat'; found: Found[]; edge?: number }> {
  const zxing = await decodeZxing(pixels)
  if (zxing.length) return { engine: 'zxing', found: zxing }
  const long = Math.max(pixels.width, pixels.height)
  const wechat = await decodeWechat(pixels)
  if (wechat.length) return { engine: 'wechat', found: wechat, edge: long }
  for (const edge of WECHAT_RETRY_EDGES.filter((e) => e < long)) {
    const small = shrink(pixels, edge)
    const found = await decodeWechat(small)
    if (found.length) {
      return { engine: 'wechat', edge, found: found.map((f) => ({ ...f, corners: f.corners.map((q) => ({ x: q.x / small.kx, y: q.y / small.ky })) as Found['corners'] })) }
    }
  }
  return { engine: 'wechat', found: [] }
}

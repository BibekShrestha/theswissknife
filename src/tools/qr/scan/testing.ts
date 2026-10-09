/**
 * Test-only helpers. The worker's ?url import names a path Node cannot
 * fetch, so ZXing gets its wasm bytes from disk; getBuiltinModule (Node
 * 22.3+) reads them without pulling Node's types into the app.
 */

import { prepareZXingModule } from 'zxing-wasm/reader'
import { decodeWechat, decodeZxing, type Found, type Pixels } from './engine'

const { readFileSync } = (globalThis as unknown as {
  process: { getBuiltinModule(id: 'node:fs'): { readFileSync(path: URL): Uint8Array } }
}).process.getBuiltinModule('node:fs')

const wasm = readFileSync(new URL('../../../../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm', import.meta.url))
prepareZXingModule({ overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer } })

export const readFixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url))

/** The order `decode.ts` runs them in: WeChat only when ZXing finds nothing. */
export async function readCodes(pixels: Pixels): Promise<{ engine: 'zxing' | 'wechat'; found: Found[] }> {
  const zxing = await decodeZxing(pixels)
  return zxing.length ? { engine: 'zxing', found: zxing } : { engine: 'wechat', found: await decodeWechat(pixels) }
}

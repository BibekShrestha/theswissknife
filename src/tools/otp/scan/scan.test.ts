import { describe, expect, it } from 'vitest'
import { prepareZXingModule } from 'zxing-wasm/reader'
import { qrPath } from '../qrcode'
import { parseScanned } from '../sources'
import { readQrTexts, type Pixels } from './reader'

// The worker's ?url import names a path Node cannot fetch, so ZXing gets its wasm from disk.
const { readFileSync } = (globalThis as unknown as {
  process: { getBuiltinModule(id: 'node:fs'): { readFileSync(path: URL): Uint8Array } }
}).process.getBuiltinModule('node:fs')
const wasm = readFileSync(new URL('../../../../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm', import.meta.url))
prepareZXingModule({ overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer } })

/** Rasterises the path the UI draws (horizontal runs `M x y h w v1 h -w z`) at `scale` px per module. */
function rasterise(text: string, scale = 4): Pixels {
  const { dim, d } = qrPath(text)
  const width = dim * scale
  const data = new Uint8ClampedArray(width * width * 4).fill(255)
  for (const [, x, y, w] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let py = +y * scale; py < (+y + 1) * scale; py++) {
      for (let px = +x * scale; px < (+x + +w) * scale; px++) data.fill(0, (py * width + px) * 4, (py * width + px) * 4 + 3)
    }
  }
  return { data, width, height: width }
}

describe('QR codes, drawn and read back', () => {
  it('re-import QR codes decode to the otpauth URI they were drawn from', async () => {
    const uri = 'otpauth://totp/Example:alice@example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Example&algorithm=SHA1&digits=6&period=30'
    const texts = await readQrTexts(rasterise(uri))
    expect(texts).toEqual([uri])
    expect(parseScanned(texts[0], 'qr.png')).toMatchObject({ kind: 'otpauth', account: { issuer: 'Example', name: 'alice@example.com' } })
  })

  it('a migration QR code survives the trip', async () => {
    const uri = 'otpauth-migration://offline?data=CiwKFDEyMzQ1Njc4OTAxMjM0NTY3ODkwEgVhbGljZRoHRXhhbXBsZSABKAEwAhABGAIgAChN'
    const [text] = await readQrTexts(rasterise(uri, 3))
    const source = parseScanned(text, 'export.png')
    expect(source.kind === 'migration' && source.payload.accounts.map((a) => a.name)).toEqual(['alice'])
  })

  it('finds nothing in a blank image', async () => {
    expect(await readQrTexts({ data: new Uint8ClampedArray(64 * 64 * 4).fill(255), width: 64, height: 64 })).toEqual([])
  })
})

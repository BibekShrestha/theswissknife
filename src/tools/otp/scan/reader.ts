import { readBarcodes, type ReaderOptions } from 'zxing-wasm/reader'

export interface Pixels { data: Uint8ClampedArray; width: number; height: number }

/** Every QR code in the image, with ZXing-C++'s retries (harder, rotated, inverted, downscaled). */
const OPTIONS: ReaderOptions = {
  formats: ['QRCode'],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 255,
}

/** ZXing-C++ (wasm). The caller prepares the module, which says where the wasm lives. */
export async function readQrTexts(pixels: Pixels): Promise<string[]> {
  const image = { ...pixels, colorSpace: 'srgb' } as ImageData
  const results = await readBarcodes(image, OPTIONS)
  return results.filter((r) => r.isValid).map((r) => r.text)
}

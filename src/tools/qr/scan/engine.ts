import { readBarcodes, type ReaderOptions } from 'zxing-wasm/reader'

export interface Point { x: number; y: number }

export type Engine = 'zxing' | 'wechat'

export interface Found {
  text: string
  /** Raw payload length; WeChat does not report it. */
  bytes?: number
  /** Symbol version 1–40; WeChat does not report it. */
  version?: number
  /** Error-correction level (L/M/Q/H); WeChat does not report it. */
  ecLevel?: string
  /** Clockwise from top-left, in the coordinates of the pixels scanned. */
  corners: [Point, Point, Point, Point]
}

export interface Pixels { data: Uint8ClampedArray; width: number; height: number }

/**
 * Every retry ZXing-C++ offers, and every code in the image. On BoofCV's
 * 1,232-code benchmark this reads 78% where jsQR read 10%, in a tenth of the time.
 */
export const ZXING_OPTIONS: ReaderOptions = {
  formats: ['QRCode'],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 255,
}

/** ZXing-C++ (wasm). The caller prepares the module, which says where the wasm lives. */
export async function decodeZxing(pixels: Pixels): Promise<Found[]> {
  const image = { ...pixels, colorSpace: 'srgb' } as ImageData
  const results = await readBarcodes(image, ZXING_OPTIONS)
  return results.filter((r) => r.isValid).map((r) => {
    const p = r.position
    return {
      text: r.text,
      bytes: r.bytes.length,
      version: Number(r.version) || undefined,
      ecLevel: r.ecLevel || undefined,
      corners: [p.topLeft, p.topRight, p.bottomRight, p.bottomLeft].map(({ x, y }) => ({ x, y })) as Found['corners'],
    }
  })
}

// OpenCV's minimal wasm build ships untyped; this is the slice we touch.
interface CvMat { floatAt(row: number, col: number): number; delete(): void }
interface CvMatVector { get(i: number): CvMat; size(): number; delete(): void }
interface CvStrings { get(i: number): string; size(): number }
interface Cv {
  IMREAD_GRAYSCALE: number
  imread(image: Pixels, flags: number): CvMat
  MatVector: new () => CvMatVector
  FS_createDataFile(dir: string, name: string, data: Uint8Array, read: boolean, write: boolean, own: boolean): void
  wechat_qrcode_WeChatQRCode: new (...files: string[]) => { detectAndDecode(image: CvMat, points: CvMatVector): CvStrings }
}

let wechat: Promise<{ cv: Cv; detector: InstanceType<Cv['wechat_qrcode_WeChatQRCode']> }> | null = null

/**
 * OpenCV's WeChat decoder (a CNN detector plus super-resolution) bundled
 * with its models: ~2.5 MB gzipped, so it is imported only when ZXing finds
 * nothing. It wins where ZXing is weakest — damaged, glare, non-compliant.
 */
function loadWechat() {
  wechat ??= (async () => {
    const models = await import('qr-scanner-wechat/wasm')
    // The Emscripten module is a thenable; awaiting it runs the initialiser.
    const cv = (await models.cv) as Cv
    const files = { 'detect.prototxt': models.detect_prototxt, 'detect.caffemodel': models.detect_caffemodel, 'sr.prototxt': models.sr_prototxt, 'sr.caffemodel': models.sr_caffemodel }
    for (const [name, data] of Object.entries(files)) cv.FS_createDataFile('/', name, data, true, false, false)
    return { cv, detector: new cv.wechat_qrcode_WeChatQRCode(...Object.keys(files)) }
  })()
  return wechat
}

export async function decodeWechat(pixels: Pixels): Promise<Found[]> {
  const { cv, detector } = await loadWechat()
  const gray = cv.imread(pixels, cv.IMREAD_GRAYSCALE)
  const points = new cv.MatVector()
  try {
    const texts = detector.detectAndDecode(gray, points)
    const out: Found[] = []
    for (let i = 0; i < texts.size(); i++) {
      const m = points.get(i)
      const corners = [0, 1, 2, 3].map((j) => ({ x: m.floatAt(j, 0), y: m.floatAt(j, 1) })) as Found['corners']
      m.delete()
      if (texts.get(i)) out.push({ text: texts.get(i), corners })
    }
    return out
  } finally {
    gray.delete()
    points.delete()
  }
}

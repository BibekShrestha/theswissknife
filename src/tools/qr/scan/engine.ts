import jsQR from 'jsqr'

export interface Point { x: number; y: number }

export interface Found {
  text: string
  /** Raw byte length of the payload, which may not be UTF-8. */
  bytes: number
  version: number
  /** Corners in the coordinates of the image that was scanned. */
  corners: [Point, Point, Point, Point]
}

/**
 * Box-blurs to grey RGBA with running sums, so the cost does not grow with
 * the radius. Styled codes need it: jsQR finds finder patterns by the
 * 1:1:3:1:1 run lengths of square modules, and dot modules or rounded eyes
 * break those runs until a blur of about a third of a module merges them.
 */
export function blurGray(data: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
  const gray = new Float32Array(width * height)
  for (let i = 0; i < gray.length; i++) gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  const pass = (src: Float32Array, len: number, lines: number, step: number, lineStep: number) => {
    const out = new Float32Array(src.length)
    for (let line = 0; line < lines; line++) {
      const base = line * lineStep
      const at = (i: number) => src[base + Math.min(len - 1, Math.max(0, i)) * step]
      let sum = 0
      for (let i = -radius; i <= radius; i++) sum += at(i)
      for (let i = 0; i < len; i++) {
        out[base + i * step] = sum / (2 * radius + 1)
        sum += at(i + radius + 1) - at(i - radius)
      }
    }
    return out
  }
  const blurred = pass(pass(gray, width, height, 1, width), height, width, width, 1)
  const out = new Uint8ClampedArray(data.length)
  for (let i = 0; i < blurred.length; i++) {
    const v = blurred[i]
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v
    out[i * 4 + 3] = 255
  }
  return out
}

/**
 * Decodes one QR code from RGBA pixels, trying each blur radius in turn
 * (0 = as is). Pure, so the worker and the tests share it. `attemptBoth`
 * also reads light-on-dark codes.
 */
export function decodePixels(data: Uint8ClampedArray, width: number, height: number, blurs: number[] = [0]): Found | null {
  for (const radius of blurs) {
    const pixels = radius > 0 ? blurGray(data, width, height, radius) : data
    const hit = jsQR(pixels, width, height, { inversionAttempts: 'attemptBoth' })
    if (!hit) continue
    const l = hit.location
    return {
      text: hit.data,
      bytes: hit.binaryData.length,
      version: hit.version,
      corners: [l.topLeftCorner, l.topRightCorner, l.bottomRightCorner, l.bottomLeftCorner],
    }
  }
  return null
}

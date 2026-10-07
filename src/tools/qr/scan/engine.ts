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
 * Decodes one QR code from RGBA pixels. Pure, so the worker and the tests
 * share it. `attemptBoth` also reads light-on-dark codes.
 */
export function decodePixels(data: Uint8ClampedArray, width: number, height: number): Found | null {
  const hit = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' })
  if (!hit) return null
  const l = hit.location
  return {
    text: hit.data,
    bytes: hit.binaryData.length,
    version: hit.version,
    corners: [l.topLeftCorner, l.topRightCorner, l.bottomRightCorner, l.bottomLeftCorner],
  }
}

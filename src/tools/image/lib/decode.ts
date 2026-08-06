/**
 * Decoding, including the awkward case.
 *
 * Raster files go straight to `createImageBitmap`, which the worker can do on
 * its own thread. SVG cannot: Chrome's `createImageBitmap` rejects SVG blobs,
 * so an SVG is measured, then drawn through an <img> on the main thread — and
 * drawn at its final size, because rasterising once at the output resolution
 * is sharper than rasterising big and scaling down.
 */

import { createCanvas } from './encode'
import type { Size } from './dimensions'

/** Used when an SVG declares no size at all, only a stretchy viewBox. */
export const SVG_FALLBACK_LONG_EDGE = 1024

export interface MeasuredSvg {
  text: string
  intrinsic: Size
  /** True when the size came from the fallback rather than the file. */
  assumed: boolean
}

export async function decodeRaster(file: Blob): Promise<ImageBitmap> {
  // from-image honours EXIF rotation, so phone photos do not come out sideways
  return createImageBitmap(file, { imageOrientation: 'from-image' })
}

export async function measureSvg(file: Blob): Promise<MeasuredSvg> {
  const text = await file.text()
  const openTag = /<svg\b[^>]*>/i.exec(text)?.[0] ?? ''
  const width = lengthAttribute(openTag, 'width')
  const height = lengthAttribute(openTag, 'height')
  if (width && height) return { text, intrinsic: { width, height }, assumed: false }

  const viewBox = /viewBox\s*=\s*["']\s*([-\d.eE+]+)[,\s]+([-\d.eE+]+)[,\s]+([\d.eE+]+)[,\s]+([\d.eE+]+)/i
    .exec(openTag)
  if (viewBox) {
    const boxWidth = Number(viewBox[3])
    const boxHeight = Number(viewBox[4])
    if (boxWidth > 0 && boxHeight > 0) {
      if (width) return { text, intrinsic: { width, height: (width * boxHeight) / boxWidth }, assumed: false }
      if (height) return { text, intrinsic: { width: (height * boxWidth) / boxHeight, height }, assumed: false }
      const scale = SVG_FALLBACK_LONG_EDGE / Math.max(boxWidth, boxHeight)
      return { text, intrinsic: { width: boxWidth * scale, height: boxHeight * scale }, assumed: true }
    }
  }

  if (width) return { text, intrinsic: { width, height: width }, assumed: true }
  if (height) return { text, intrinsic: { width: height, height }, assumed: true }
  return {
    text,
    intrinsic: { width: SVG_FALLBACK_LONG_EDGE, height: SVG_FALLBACK_LONG_EDGE },
    assumed: true,
  }
}

/** Rasterises SVG markup at exactly the requested size. Main thread only. */
export async function rasterizeSvg(text: string, target: Size): Promise<ImageBitmap> {
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.width = target.width
    img.height = target.height
    img.decoding = 'sync'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('This SVG could not be rendered'))
      img.src = url
    })
    const canvas = createCanvas(target.width, target.height)
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null
    if (!ctx) throw new Error('Could not get a 2D canvas context')
    ctx.drawImage(img, 0, 0, target.width, target.height)
    return await createImageBitmap(canvas)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Reads a CSS length that browsers treat as pixels; %, em and friends yield null. */
function lengthAttribute(tag: string, name: string): number | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']?\\s*([\\d.]+)(px)?\\s*["']?`, 'i').exec(tag)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) && value > 0 ? value : null
}

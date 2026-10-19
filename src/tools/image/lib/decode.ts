/**
 * Decoding, including the awkward case.
 *
 * Raster files go straight to `createImageBitmap`, which the worker can do on
 * its own thread. SVG cannot: Chrome's `createImageBitmap` rejects SVG blobs,
 * so an SVG is measured, then drawn through an <img> on the main thread — and
 * drawn at its final size, because rasterising once at the output resolution
 * is sharper than rasterising big and scaling down.
 */

import type { Size } from './dimensions'
import { createCanvas } from './encode'
import { svgSize, type SvgSize } from './svgSize'

export interface MeasuredSvg extends SvgSize {
  text: string
}

export async function decodeRaster(file: Blob): Promise<ImageBitmap> {
  // from-image honours EXIF rotation, so phone photos do not come out sideways
  return createImageBitmap(file, { imageOrientation: 'from-image' })
}

/** Width and height from the root <svg> only; see svgSize for units and fallbacks. */
export async function measureSvg(file: Blob): Promise<MeasuredSvg> {
  const text = await file.text()
  return { text, ...svgSize(text) }
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

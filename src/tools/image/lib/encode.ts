/**
 * Canvas plumbing: resize, then hand the pixels to an encoder.
 *
 * Written against both canvas flavours so the worker (OffscreenCanvas) and the
 * main-thread fallback (a DOM canvas, for browsers without
 * OffscreenCanvas.convertToBlob) run exactly the same code.
 */

import { downscaleSteps, type Size } from './dimensions'
import { formatInfo, type OutFormat } from './formats'

export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement

export interface GifSettings {
  maxColors: number
  dither: boolean
}

export function canUseOffscreen(): boolean {
  return (
    typeof OffscreenCanvas !== 'undefined' &&
    typeof OffscreenCanvas.prototype.convertToBlob === 'function'
  )
}

export function createCanvas(width: number, height: number): AnyCanvas {
  if (canUseOffscreen()) return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/**
 * Draws the bitmap at the requested size, halving first when the reduction is
 * large: browsers only average a few neighbouring pixels per step, so one
 * giant downscale aliases where a few halvings stay smooth.
 */
export function renderToCanvas(
  source: ImageBitmap,
  target: Size,
  matte: string | null,
): AnyCanvas {
  let current: ImageBitmap | AnyCanvas = source
  for (const step of downscaleSteps({ width: source.width, height: source.height }, target)) {
    current = paint(current, step, null)
  }
  return paint(current, target, matte)
}

function paint(source: ImageBitmap | AnyCanvas, size: Size, matte: string | null): AnyCanvas {
  const canvas = createCanvas(size.width, size.height)
  const ctx = context(canvas)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  if (matte) {
    ctx.fillStyle = matte
    ctx.fillRect(0, 0, size.width, size.height)
  }
  ctx.drawImage(source as CanvasImageSource, 0, 0, size.width, size.height)
  return canvas
}

export async function encodeCanvas(
  canvas: AnyCanvas,
  format: OutFormat,
  quality: number,
  gif: GifSettings,
): Promise<Blob> {
  if (format === 'gif') return encodeGifCanvas(canvas, gif)

  const { mime, label } = formatInfo(format)
  const blob =
    'convertToBlob' in canvas
      ? await canvas.convertToBlob({ type: mime, quality })
      : await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (out) => (out ? resolve(out) : reject(new Error(`Could not encode ${label}`))),
            mime,
            quality,
          )
        })

  // Safari quietly hands back a PNG for formats it cannot write, so say so
  // instead of shipping a mislabelled file.
  if (blob.type !== mime) throw new Error(`This browser cannot write ${label} files`)
  return blob
}

/**
 * The GIF path. Imported on demand: the quantizer and LZW coder are only
 * needed when someone actually asks for a GIF, so they stay out of the chunk
 * that loads with the tool.
 */
async function encodeGifCanvas(canvas: AnyCanvas, gif: GifSettings): Promise<Blob> {
  const { width, height } = canvas
  const pixels = context(canvas).getImageData(0, 0, width, height)
  const [{ quantize }, { encodeGif }] = await Promise.all([
    import('../gif/quantize'),
    import('../gif/encode'),
  ])
  const quantized = quantize(pixels.data, width, height, {
    maxColors: gif.maxColors,
    dither: gif.dither,
  })
  const bytes = encodeGif(
    [
      {
        indices: quantized.indices,
        palette: quantized.palette,
        transparentIndex: quantized.transparentIndex,
      },
    ],
    width,
    height,
  )
  return new Blob([bytes as unknown as BlobPart], { type: 'image/gif' })
}

/** Which output formats this browser can actually write, GIF always included. */
export async function probeEncoders(): Promise<OutFormat[]> {
  const canvas = createCanvas(1, 1)
  // convertToBlob refuses a canvas that has never had a rendering context
  context(canvas)
  const supported: OutFormat[] = []
  for (const info of [formatInfo('png'), formatInfo('jpeg'), formatInfo('webp')]) {
    try {
      await encodeCanvas(canvas, info.id, 0.5, { maxColors: 256, dither: false })
      supported.push(info.id)
    } catch {
      // format unsupported here; it stays out of the picker
    }
  }
  supported.push('gif') // ours, so it works everywhere
  return supported
}

function context(canvas: AnyCanvas): CanvasRenderingContext2D {
  // The two context types differ only in ways this file does not touch.
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null
  if (!ctx) throw new Error('Could not get a 2D canvas context')
  return ctx
}

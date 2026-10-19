/**
 * Turning a drawn, typed or picked signature into a transparent PNG, on a
 * canvas in this tab. Nothing is stored: the bytes live in memory until
 * the tab or the tool is closed.
 */
import { alphaBounds, strokeSegments, strokesBounds, whiteToAlpha, type Box, type Pt } from './pad'

export interface SignatureImage {
  png: Uint8Array
  /** An object URL for the overlay; revoked when the signature is discarded. */
  url: string
  /** Pixel size of the PNG. */
  width: number
  height: number
  /** How it was made, for the item's accessible name ("Drawn signature"). */
  label: string
}

/** The pen width on the pad, in CSS pixels. */
export const PEN_WIDTH = 2.6
/** Drawn signatures are written at this many pixels per CSS pixel, so they stay sharp when enlarged on the page. */
const EXPORT_SCALE = 3
/** Long side of a picked image after downscaling: plenty for a signature, small in the PDF. */
const MAX_IMAGE_SIDE = 1600

export const INK_COLORS = [
  { id: 'black', label: 'Black', value: '#111111' },
  { id: 'blue', label: 'Blue', value: '#1b3a8c' },
] as const

/** Handwriting-style fonts commonly installed with macOS, Windows and Linux; the generic `cursive` catches the rest. No web fonts are fetched. */
export const SCRIPT_FONTS = [
  { id: 'script', label: 'Script', stack: "'Snell Roundhand', 'Segoe Script', 'URW Chancery L', 'Apple Chancery', cursive" },
  { id: 'chancery', label: 'Chancery', stack: "'Apple Chancery', 'Lucida Handwriting', 'URW Chancery L', 'Z003', cursive" },
  { id: 'brush', label: 'Brush', stack: "'Brush Script MT', 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', cursive" },
] as const

export function paintStrokes(ctx: CanvasRenderingContext2D, strokes: Pt[][], color: string, width: number): void {
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const stroke of strokes) {
    ctx.beginPath()
    for (const s of strokeSegments(stroke)) {
      if (s.kind === 'dot') {
        ctx.moveTo(s.at.x + width / 2, s.at.y)
        ctx.arc(s.at.x, s.at.y, width / 2, 0, Math.PI * 2)
        ctx.fill()
        continue
      }
      ctx.moveTo(s.from.x, s.from.y)
      if (s.kind === 'line') ctx.lineTo(s.to.x, s.to.y)
      else ctx.quadraticCurveTo(s.ctrl.x, s.ctrl.y, s.to.x, s.to.y)
    }
    ctx.stroke()
  }
}

async function toPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('The browser could not encode the signature as PNG.')
  return new Uint8Array(await blob.arrayBuffer())
}

function crop(source: HTMLCanvasElement, box: Box): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = box.width
  out.height = box.height
  out.getContext('2d')!.drawImage(source, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height)
  return out
}

async function finish(canvas: HTMLCanvasElement, label: string): Promise<SignatureImage> {
  const png = await toPngBytes(canvas)
  const url = URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' }))
  return { png, url, width: canvas.width, height: canvas.height, label }
}

/** The strokes (CSS px on a w×h pad) as a transparent PNG cropped to the ink, or null for an empty pad. */
export async function drawnSignature(strokes: Pt[][], color: string, w: number, h: number): Promise<SignatureImage | null> {
  const box = strokesBounds(strokes, PEN_WIDTH, w, h)
  if (!box) return null
  const k = EXPORT_SCALE
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(box.width * k)
  canvas.height = Math.ceil(box.height * k)
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(k, 0, 0, k, -box.x * k, -box.y * k)
  paintStrokes(ctx, strokes, color, PEN_WIDTH)
  return finish(canvas, 'Drawn signature')
}

/** Typed text in a handwriting font, drawn large and cropped to its ink. Null when nothing visible was drawn. */
export function typedCanvas(text: string, stack: string, color: string, size = 96): HTMLCanvasElement | null {
  const line = text.trim()
  if (!line) return null
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const font = `${size}px ${stack}`
  ctx.font = font
  // generous room: swashes reach past the measured box
  const width = Math.ceil(ctx.measureText(line).width + size * 2)
  canvas.width = Math.min(width, 8000)
  canvas.height = Math.ceil(size * 2.2)
  ctx.font = font
  ctx.fillStyle = color
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(line, size, size * 1.4)
  const box = alphaBounds(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)
  if (!box) return null
  const pad = Math.round(size * 0.05)
  const [x0, y0] = [Math.max(0, box.x - pad), Math.max(0, box.y - pad)]
  const [x1, y1] = [Math.min(canvas.width, box.x + box.width + pad), Math.min(canvas.height, box.y + box.height + pad)]
  return crop(canvas, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 })
}

export async function typedSignature(text: string, stack: string, color: string): Promise<SignatureImage | null> {
  const canvas = typedCanvas(text, stack, color)
  return canvas ? finish(canvas, 'Typed signature') : null
}

/**
 * A picked image (any format the browser decodes, EXIF orientation applied)
 * as PNG, at most MAX_IMAGE_SIDE on its long side, with its white paper
 * made transparent and cropped away when asked.
 */
export async function pickedSignature(file: Blob, clearPaper: boolean): Promise<SignatureImage> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('That file could not be read as an image.')
  }
  const k = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height))
  let canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * k))
  canvas.height = Math.max(1, Math.round(bitmap.height * k))
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  if (clearPaper) {
    whiteToAlpha(image.data)
    ctx.putImageData(image, 0, 0)
  }
  const box = alphaBounds(image.data, canvas.width, canvas.height)
  if (!box) throw new Error(clearPaper ? 'Nothing is left once the white background is removed — untick that option for this image.' : 'That image is fully transparent.')
  if (box.width < canvas.width || box.height < canvas.height) canvas = crop(canvas, box)
  return finish(canvas, 'Signature image')
}

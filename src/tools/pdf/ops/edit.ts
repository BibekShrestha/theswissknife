/** Compress, page numbers and watermark: whole-document edits with pdf-lib. */
import { StandardFonts, rgb } from 'pdf-lib'
import { loadPdf, PdfInputError } from '../lib/load'
import { viewFrame } from '../lib/place'
import { step } from '../lib/work'

/**
 * Re-saves the document with pdf-lib, packing objects into compressed object
 * streams and keeping only the latest version of each object (incrementally
 * saved files carry every earlier one too). Images and fonts are not
 * touched, so the saving is often small and can be nothing.
 */
export async function compressPdf(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await loadPdf(bytes)
  return doc.save({ useObjectStreams: true })
}

export type Corner = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'
export type NumberStyle = 'numeric' | 'roman' | 'custom'

export function toRoman(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 3999) return String(n)
  const table: [number, string][] = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
    [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
  ]
  let out = ''
  for (const [value, numeral] of table) {
    while (n >= value) {
      out += numeral
      n -= value
    }
  }
  return out
}

export interface PageNumberOptions {
  position: Corner
  style: NumberStyle
  prefix: string
  startFrom: number
}

const NUMBER_SIZE = 10
const MARGIN = 40

/** Places each label within the visible, upright page — rotated pages included. */
export async function addPageNumbers(bytes: Uint8Array, options: PageNumberOptions): Promise<Uint8Array> {
  const doc = await loadPdf(bytes)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const label = (n: number) => (options.style === 'roman' ? toRoman(n) : options.style === 'custom' ? `${options.prefix}${n}` : String(n))
  doc.getPages().forEach((page, i) => {
    step()
    const frame = viewFrame(page)
    const text = label(i + options.startFrom)
    const width = font.widthOfTextAtSize(text, NUMBER_SIZE)
    const [vertical, horizontal] = options.position.split('-')
    const x = horizontal === 'left' ? MARGIN : horizontal === 'right' ? frame.width - MARGIN - width : (frame.width - width) / 2
    const y = vertical === 'top' ? frame.height - MARGIN : MARGIN
    frame.drawText(text, x, y, { size: NUMBER_SIZE, font, color: rgb(0, 0, 0) })
  })
  return doc.save()
}

export type WatermarkPosition = 'center' | 'tile' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface WatermarkOptions {
  text: string
  /** 0–1 */
  opacity: number
  position: WatermarkPosition
}

export async function addWatermark(bytes: Uint8Array, options: WatermarkOptions): Promise<Uint8Array> {
  if (!options.text.trim()) throw new PdfInputError('Enter the watermark text.')
  const doc = await loadPdf(bytes)
  const font = await doc.embedFont(StandardFonts.HelveticaBold)
  const style = { font, color: rgb(0, 0, 0), opacity: options.opacity }
  for (const page of doc.getPages()) {
    step()
    const frame = viewFrame(page)
    const { text } = options
    if (options.position === 'tile') {
      const size = 20
      const stepX = font.widthOfTextAtSize(text, size) + 100
      for (let x = 0; x < frame.width; x += stepX) {
        for (let y = 0; y < frame.height; y += 100) frame.drawText(text, x, y, { ...style, size })
      }
      continue
    }
    // a tenth of the short side, smaller when that would run past the margins
    const size = Math.min(Math.min(frame.width, frame.height) * 0.1, (frame.width - 2 * MARGIN) / font.widthOfTextAtSize(text, 1))
    const width = font.widthOfTextAtSize(text, size)
    // the capitals' height, so centring puts the visible text mid-page rather than its baseline
    const capHeight = font.heightAtSize(size, { descender: false })
    const spots: Record<Exclude<WatermarkPosition, 'tile'>, [number, number]> = {
      center: [(frame.width - width) / 2, (frame.height - capHeight) / 2],
      'top-left': [MARGIN, frame.height - MARGIN - size],
      'top-right': [frame.width - width - MARGIN, frame.height - MARGIN - size],
      'bottom-left': [MARGIN, MARGIN],
      'bottom-right': [frame.width - width - MARGIN, MARGIN],
    }
    const [x, y] = spots[options.position]
    frame.drawText(text, x, y, { ...style, size })
  }
  return doc.save()
}

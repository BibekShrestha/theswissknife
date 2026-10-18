/** Image to PDF: one page per image, sized to the image (1 px = 1 pt). */
import { PDFDocument, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState, type PDFImage } from 'pdf-lib'
import { PdfInputError } from '../lib/load'
import type { NamedBytes } from './organize'

/** Re-encodes an image pdf-lib cannot embed (WebP, …) as PNG; the browser supplies one. */
export type ToPng = (bytes: Uint8Array) => Promise<Uint8Array>

export function imageKind(bytes: Uint8Array): 'png' | 'jpeg' | 'other' {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  return 'other'
}

/**
 * The EXIF orientation (1–8) of a JPEG, 1 when absent. Cameras store the
 * sensor's pixels and record the turn here; PDF viewers ignore EXIF, so
 * without applying it a portrait phone photo lands on its side.
 */
export function jpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 2
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return 1
    const marker = bytes[at + 1]
    if (marker === 0xff) {
      at++ // fill byte
      continue
    }
    if (marker === 0xda || marker === 0xd9) return 1 // image data starts: no EXIF before it
    const length = view.getUint16(at + 2)
    const exif = at + 4
    if (marker === 0xe1 && exif + 14 <= bytes.length && view.getUint32(exif) === 0x45786966 && view.getUint16(exif + 4) === 0) {
      const tiff = exif + 6
      const little = view.getUint16(tiff) === 0x4949
      const u16 = (o: number) => view.getUint16(o, little)
      const ifd = tiff + view.getUint32(tiff + 4, little)
      if (ifd + 2 > bytes.length) return 1
      const count = u16(ifd)
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12
        if (entry + 12 > bytes.length) return 1
        if (u16(entry) === 0x0112) {
          const value = u16(entry + 8)
          return value >= 1 && value <= 8 ? value : 1
        }
      }
      return 1
    }
    at += 2 + length
  }
  return 1
}

/**
 * The PDF matrix [a b c d e f] that draws a w×h image (stored pixels) so it
 * appears the way EXIF orientation `o` says, on a page of the displayed size.
 */
export function orientationMatrix(o: number, w: number, h: number): [number, number, number, number, number, number] {
  switch (o) {
    case 2: return [-w, 0, 0, h, w, 0]
    case 3: return [-w, 0, 0, -h, w, h]
    case 4: return [w, 0, 0, -h, 0, h]
    case 5: return [0, -w, -h, 0, h, w]
    case 6: return [0, -w, h, 0, 0, w]
    case 7: return [0, w, h, 0, 0, 0]
    case 8: return [0, w, -h, 0, h, 0]
    default: return [w, 0, 0, h, 0, 0]
  }
}

export async function imagesToPdf(inputs: NamedBytes[], toPng?: ToPng): Promise<Uint8Array> {
  if (inputs.length === 0) throw new PdfInputError('Choose at least one image.')
  const pdf = await PDFDocument.create()
  for (const { name, bytes } of inputs) {
    let kind = imageKind(bytes)
    let data = bytes
    if (kind === 'other') {
      if (!toPng) throw new PdfInputError(`${name} is not a PNG or JPEG image.`)
      try {
        data = await toPng(bytes)
      } catch {
        throw new PdfInputError(`${name} could not be read as an image.`)
      }
      kind = 'png'
    }
    let image: PDFImage
    try {
      image = kind === 'png' ? await pdf.embedPng(data) : await pdf.embedJpg(data)
    } catch {
      throw new PdfInputError(`${name} could not be read as an image — it may be damaged.`)
    }
    const orientation = kind === 'jpeg' ? jpegOrientation(data) : 1
    const { width: w, height: h } = image
    const page = pdf.addPage(orientation >= 5 ? [h, w] : [w, h])
    const xObject = page.node.newXObject('Image', image.ref)
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...orientationMatrix(orientation, w, h)), drawObject(xObject), popGraphicsState())
  }
  return pdf.save()
}

/** PDF to Text and PDF to Image: reading with pdf.js. */
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { ENCRYPTED_MESSAGE, hasPdfHeader, PdfInputError } from '../lib/errors'

type PdfJs = typeof import('pdfjs-dist')

/** Opens bytes with pdf.js, turning its failures into messages for the user. */
export async function openPdf(pdfjs: PdfJs, bytes: Uint8Array): Promise<{ doc: PDFDocumentProxy; close: () => Promise<void> }> {
  if (!hasPdfHeader(bytes)) throw new PdfInputError('This file is not a PDF.')
  // pdf.js transfers (detaches) the buffer it is given
  const task = pdfjs.getDocument({ data: bytes.slice() })
  try {
    return { doc: await task.promise, close: () => task.destroy() }
  } catch (e) {
    await task.destroy()
    if ((e as { name?: string }).name === 'PasswordException') throw new PdfInputError(ENCRYPTED_MESSAGE)
    throw new PdfInputError('This PDF could not be read — it may be damaged or truncated.')
  }
}

interface TextItemLike {
  str?: string
  hasEOL?: boolean
}

/**
 * pdf.js text items are runs of glyphs, not words: one word can be split
 * over several items, and pdf.js already emits the spaces it infers. So
 * items are concatenated as they are, with a line break where pdf.js marks
 * the end of a line — joining them with spaces splits words apart.
 */
export function joinTextItems(items: TextItemLike[]): string {
  let out = ''
  for (const item of items) {
    if (typeof item.str === 'string') out += item.str
    if (item.hasEOL) out += '\n'
  }
  return out.replace(/[ \t]+\n/g, '\n').trimEnd()
}

/** The text of every page, one string per page. */
export async function extractText(pdfjs: PdfJs, bytes: Uint8Array): Promise<string[]> {
  const { doc, close } = await openPdf(pdfjs, bytes)
  try {
    const pages: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      pages.push(joinTextItems((await page.getTextContent()).items as TextItemLike[]))
      page.cleanup()
    }
    return pages
  } finally {
    await close()
  }
}

/**
 * The render scale for a page of w×h points: 2× (144 dpi), reduced so the
 * canvas stays inside what every browser can allocate — past ~16 megapixels
 * (Safari) or 16384 px a side, canvases silently come back empty.
 */
export const MAX_CANVAS_SIDE = 8192
export const MAX_CANVAS_AREA = 16_000_000

export function renderScale(w: number, h: number, preferred = 2): number {
  if (!(w > 0 && h > 0)) return preferred
  return Math.min(preferred, MAX_CANVAS_SIDE / w, MAX_CANVAS_SIDE / h, Math.sqrt(MAX_CANVAS_AREA / (w * h)))
}

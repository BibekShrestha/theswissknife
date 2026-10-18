/**
 * Test-only helpers: fixture PDFs built with pdf-lib, and pdf.js (the
 * reader the site itself uses) to check outputs independently of the code
 * that wrote them.
 */
import { readFile } from './node'
import { PDFDocument, PDFName, PDFString, StandardFonts, degrees } from 'pdf-lib'

type PdfJs = typeof import('pdfjs-dist')
let pdfjsPromise: Promise<PdfJs> | null = null

export function nodePdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((m) => {
    const pdfjs = m as unknown as PdfJs
    pdfjs.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs'
    return pdfjs
  })
  return pdfjsPromise
}

export function fixture(name: string): Uint8Array {
  return readFile(new URL(`./fixtures/${name}`, import.meta.url))
}

/** Opens bytes with pdf.js; resolves to the per-page text, or rejects like pdf.js does. */
export async function pdfjsText(bytes: Uint8Array, password?: string): Promise<string[]> {
  const pdfjs = await nodePdfJs()
  const task = pdfjs.getDocument({ data: bytes.slice(), password, verbosity: 0 })
  const doc = await task.promise
  try {
    const pages: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent()
      pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(''))
    }
    return pages
  } finally {
    await task.destroy()
  }
}

/** pdf.js's PasswordResponses code when it refuses to open, or 'opened'. */
export async function pdfjsOpen(bytes: Uint8Array, password?: string): Promise<'opened' | 'need-password' | 'incorrect-password' | string> {
  try {
    await pdfjsText(bytes, password)
    return 'opened'
  } catch (e) {
    const err = e as { name?: string; code?: number; message?: string }
    if (err.name === 'PasswordException') return err.code === 1 ? 'need-password' : 'incorrect-password'
    return `${err.name}: ${err.message}`
  }
}

export interface PageSpec {
  size?: [number, number]
  rotate?: number
  text?: string
}

/** A document whose page i reads `Page i` (or spec.text), with the given sizes and rotations. */
export async function makePdf(pages: PageSpec[] | number, info: { title?: string } = {}): Promise<Uint8Array> {
  const specs = typeof pages === 'number' ? Array.from({ length: pages }, () => ({})) : pages
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  specs.forEach((spec: PageSpec, i) => {
    const page = doc.addPage(spec.size ?? [300, 400])
    page.drawText(spec.text ?? `Page ${i + 1}`, { x: 20, y: 20, size: 12, font })
    if (spec.rotate) page.setRotation(degrees(spec.rotate))
  })
  if (info.title) doc.setTitle(info.title)
  return doc.save()
}

/** Page texts as pdf-lib-independent ground truth: what pdf.js reads off each page. */
export async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  return pdfjsText(bytes)
}

export async function pageInfo(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes)
  return doc.getPages().map((p) => ({ ...p.getSize(), rotate: p.getRotation().angle }))
}

/** A small document with an outline entry and a filled text field. */
export async function makeRichPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < 2; i++) doc.addPage([300, 400]).drawText(`Page ${i + 1}`, { x: 20, y: 20, size: 12, font })
  const form = doc.getForm()
  const field = form.createTextField('name')
  field.setText('Ada')
  field.addToPage(doc.getPage(0), { x: 20, y: 300, width: 200, height: 24 })
  const outline = doc.context.obj({ Type: 'Outlines', Count: 1 })
  const outlineRef = doc.context.register(outline)
  const item = doc.context.register(
    doc.context.obj({ Title: PDFString.of('Chapter 1'), Parent: outlineRef, Dest: [doc.getPage(1).ref, PDFName.of('Fit')] }),
  )
  outline.set(PDFName.of('First'), item)
  outline.set(PDFName.of('Last'), item)
  doc.catalog.set(PDFName.of('Outlines'), outlineRef)
  doc.setTitle('Rich fixture')
  doc.setAuthor('Fixture author')
  return doc.save()
}

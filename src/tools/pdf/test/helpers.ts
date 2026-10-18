/**
 * Test-only helpers: fixture PDFs built with pdf-lib, and pdf.js (the
 * reader the site itself uses) to check outputs independently of the code
 * that wrote them.
 */
import { readFile } from './node'
import { PDFDict, PDFDocument, PDFName, PDFObject, PDFRawStream, PDFRef, PDFString, StandardFonts, decodePDFRawStream, degrees } from 'pdf-lib'

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

/**
 * Appends an incremental update with a classic xref table (no /XRefStm) on
 * top of `base`, the way many editors save: `objects` maps object numbers to
 * their new bodies (PDF syntax).
 */
export function appendClassicUpdate(base: Uint8Array, objects: Record<number, string>): Uint8Array {
  const text = new TextDecoder('latin1').decode(base)
  const prev = Number([...text.matchAll(/startxref\s+(\d+)/g)].pop()![1])
  const root = [...text.matchAll(/\/Root (\d+ \d+ R)/g)].pop()![1]
  const size = Math.max(Number([...text.matchAll(/\/Size (\d+)/g)].pop()![1]), ...Object.keys(objects).map((n) => Number(n) + 1))
  let body = '\n'
  const offsets: [number, number][] = []
  for (const [n, value] of Object.entries(objects)) {
    offsets.push([Number(n), base.length + body.length])
    body += `${n} 0 obj\n${value}\nendobj\n`
  }
  const xrefAt = base.length + body.length
  body += 'xref\n0 1\n0000000000 65535 f \n'
  for (const [n, at] of offsets) body += `${n} 1\n${String(at).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${size} /Root ${root} /Prev ${prev} >>\nstartxref\n${xrefAt}\n%%EOF\n`
  const out = new Uint8Array(base.length + body.length)
  out.set(base)
  out.set(Uint8Array.from(body, (c) => c.charCodeAt(0)), base.length)
  return out
}

/** Every indirect object of a file as pdf-lib parses it, streams decoded to latin1 text. */
export async function rawObjects(bytes: Uint8Array): Promise<{ ref: PDFRef; object: PDFObject; text: string }[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  return doc.context.enumerateIndirectObjects().map(([ref, object]) => {
    let text = object.toString()
    if (object instanceof PDFRawStream) {
      try {
        text = new TextDecoder('latin1').decode(decodePDFRawStream(object).decode())
      } catch {
        text = new TextDecoder('latin1').decode(object.contents)
      }
    }
    return { ref, object, text }
  })
}

/** Number of /Type /Page dictionaries anywhere in the file (orphans included). */
export async function pageObjectCount(bytes: Uint8Array): Promise<number> {
  return (await rawObjects(bytes)).filter(({ object }) => object instanceof PDFDict && object.get(PDFName.of('Type')) === PDFName.of('Page')).length
}

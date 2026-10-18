/**
 * Merge, split, rotate, remove and reorder: page-level edits with pdf-lib.
 * None of them copies pages with pdf-lib's copyPages (see lib/structure.ts):
 * Remove, Reorder and Split edit the parsed document in place, Merge
 * imports whole documents, so nothing that was not asked for comes along
 * and every link, bookmark and form field still points at its own page.
 */
import { PDFDocument, degrees } from 'pdf-lib'
import { loadPdf, PdfInputError } from '../lib/load'
import { describePages, parsePageGroups, parsePageList } from '../lib/pages'
import { finishMerge, forkDocument, keepPages, mergeInto, readPageLabels, type Label } from '../lib/structure'

export interface NamedBytes {
  name: string
  bytes: Uint8Array
}

function requirePages(doc: PDFDocument, name = 'This PDF'): number {
  const total = doc.getPageCount()
  if (total === 0) throw new PdfInputError(`${name} has no pages.`)
  return total
}

export interface MergeResult {
  bytes: Uint8Array
  /** What had to change on the way in (renamed form fields or attachments), for the person merging. */
  notes: string[]
}

/**
 * Document properties (title, author, XMP metadata), viewer settings and
 * named destinations come from the first file; every file's form fields,
 * bookmarks, page labels, attachments, layers and structure tree are kept.
 */
export async function mergePdfs(inputs: NamedBytes[], onProgress?: (done: number) => void): Promise<MergeResult> {
  if (inputs.length < 2) throw new PdfInputError('Choose at least two PDFs to merge.')
  const merged = await loadPdf(inputs[0].bytes, inputs[0].name)
  const labels: (Label[] | null)[] = [readPageLabels(merged)]
  const counts = [merged.getPageCount()]
  const notes: string[] = []
  onProgress?.(1)
  for (let i = 1; i < inputs.length; i++) {
    const doc = await loadPdf(inputs[i].bytes, inputs[i].name)
    counts.push(doc.getPageCount())
    notes.push(...mergeInto(merged, doc, inputs[i].name, labels))
    onProgress?.(i + 1)
  }
  if (merged.getPageCount() === 0) throw new PdfInputError('None of these PDFs has any pages.')
  finishMerge(merged, labels, counts)
  return { bytes: await merged.save(), notes }
}

export type SplitMode =
  | { kind: 'every'; pages: number }
  | { kind: 'first'; pages: number }
  | { kind: 'ranges'; ranges: string }

export async function splitPdf(bytes: Uint8Array, mode: SplitMode): Promise<NamedBytes[]> {
  const doc = await loadPdf(bytes)
  const total = requirePages(doc)
  let sets: number[][] = []
  if (mode.kind === 'every') {
    const n = Math.max(1, Math.floor(mode.pages))
    for (let i = 0; i < total; i += n) sets.push(Array.from({ length: Math.min(n, total - i) }, (_, j) => i + j))
  } else if (mode.kind === 'first') {
    const n = Math.min(Math.max(1, Math.floor(mode.pages)), total)
    sets = [Array.from({ length: n }, (_, j) => j)]
    if (n < total) sets.push(Array.from({ length: total - n }, (_, j) => n + j))
  } else {
    sets = parsePageGroups(mode.ranges, total)
  }
  const files: NamedBytes[] = []
  for (let i = 0; i < sets.length; i++) {
    // each part is cut from its own copy of the parsed file; the last can use the original
    const part = i === sets.length - 1 ? doc : forkDocument(doc)
    keepPages(part, sets[i])
    files.push({ name: `split-${i + 1}.pdf`, bytes: await part.save() })
  }
  return files
}

export type Rotation = 90 | 180 | 270

/** Turns every page clockwise by `rotation` on top of its existing /Rotate. */
export async function rotatePdf(bytes: Uint8Array, rotation: Rotation): Promise<Uint8Array> {
  const doc = await loadPdf(bytes)
  requirePages(doc)
  for (const page of doc.getPages()) {
    const current = Math.round(page.getRotation().angle / 90) * 90
    page.setRotation(degrees((((current + rotation) % 360) + 360) % 360))
  }
  return doc.save()
}

/** Links, bookmarks and form fields that only led to removed pages are removed with them. */
export async function removePages(bytes: Uint8Array, spec: string): Promise<Uint8Array> {
  const doc = await loadPdf(bytes)
  const total = requirePages(doc)
  const remove = new Set(parsePageList(spec, total))
  const keep = doc.getPageIndices().filter((i) => !remove.has(i))
  if (keep.length === 0) throw new PdfInputError('That would remove every page — a PDF needs at least one.')
  keepPages(doc, keep)
  return doc.save()
}

/** The new order must name every page exactly once (ranges such as 5-1 count). */
export async function reorderPages(bytes: Uint8Array, spec: string): Promise<Uint8Array> {
  const doc = await loadPdf(bytes)
  const total = requirePages(doc)
  const order = parsePageList(spec, total)
  const seen = new Set<number>()
  const twice = new Set<number>()
  for (const i of order) (seen.has(i) ? twice : seen).add(i)
  if (twice.size) throw new PdfInputError(`Page ${describePages([...twice].sort((a, b) => a - b))} appears more than once — list each page once.`)
  const missing = doc.getPageIndices().filter((i) => !seen.has(i))
  if (missing.length) {
    throw new PdfInputError(`The order leaves out page${missing.length === 1 ? '' : 's'} ${describePages(missing)} — list every page once (ranges like ${missing[0] + 1}-${total} work).`)
  }
  keepPages(doc, order)
  return doc.save()
}

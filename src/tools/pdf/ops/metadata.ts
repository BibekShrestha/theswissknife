/**
 * Remove Metadata: finds what a PDF says about itself and its makers, strips
 * it, and proves the result by parsing the output again — the same "N found
 * → M remain" the EXIF tool reports, where the second number never comes
 * from the stripper's own bookkeeping.
 *
 * Removed: the document Info dictionary (title, author, producer, dates…),
 * every XMP stream (the catalog's and any object's /Metadata, plus orphaned
 * ones), application data (/PieceInfo, with the private data it points to)
 * and /LastModified dates, page thumbnails (/Thumb); optionally attachments
 * and JavaScript. The file is rewritten whole and unreachable objects are
 * dropped, so earlier revisions and orphaned leftovers go too. Page content
 * streams are never touched — the re-parse compares them byte for byte.
 *
 * Images are kept byte for byte, so a photo's own EXIF inside an embedded
 * JPEG stays; it is listed, not removed.
 */
import { PDFArray, PDFDict, PDFHexString, PDFName, PDFRef, PDFStream, PDFString, type PDFContext, type PDFDocument, type PDFObject } from 'pdf-lib'
import { loadPdf } from '../lib/load'
import { collectGarbage } from '../lib/structure'
import { step } from '../lib/work'

export interface StripMetadataOptions {
  attachments: boolean
  javascript: boolean
}

export type MetadataKind = 'info' | 'xmp' | 'piece-info' | 'thumbnail' | 'attachments' | 'javascript' | 'image-metadata'

export interface MetadataFinding {
  kind: MetadataKind
  count: number
  /** Human-readable specifics: the Info entries, where XMP sits, attachment names… */
  details: string[]
}

export interface MetadataReport {
  bytes: Uint8Array
  /** What the input carried. */
  found: MetadataFinding[]
  /** What parsing the output again finds. */
  remain: MetadataFinding[]
  /** The kinds this run set out to remove. */
  targeted: MetadataKind[]
  pages: number
  /** Every page's content streams are byte-identical in the re-parsed output, and the page count is unchanged. */
  contentKept: boolean
  notes: string[]
}

const N = (name: string) => PDFName.of(name)
const MAX_DETAILS = 12
const MAX_VALUE = 120

function deref(context: PDFContext, obj: PDFObject | undefined): PDFObject | undefined {
  return obj instanceof PDFRef ? context.lookup(obj) : obj
}

function text(obj: PDFObject | undefined): string {
  let s: string
  if (obj instanceof PDFString || obj instanceof PDFHexString) s = obj.decodeText()
  else if (obj instanceof PDFName) s = obj.decodeText()
  else if (obj === undefined) s = ''
  else s = obj.toString()
  s = s.replace(/[\u0000-\u001f]+/g, ' ').trim()
  return s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE)}…` : s
}

/**
 * Every dictionary in the document — indirect objects, the dictionaries
 * nested directly inside them, and stream dictionaries — with the object
 * that holds it. References are not followed: each indirect object is
 * visited once, from the enumeration. `visit` may delete keys; children are
 * read after it returns.
 */
function walkDicts(context: PDFContext, visit: (dict: PDFDict, holder: PDFRef) => void) {
  let n = 0
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (++n % 2000 === 0) step()
    const stack: PDFObject[] = [object]
    while (stack.length) {
      const o = stack.pop()!
      if (o instanceof PDFStream) stack.push(o.dict)
      else if (o instanceof PDFDict) {
        visit(o, ref)
        for (const [, v] of o.entries()) if (!(v instanceof PDFRef)) stack.push(v)
      } else if (o instanceof PDFArray) {
        for (const v of o.asArray()) if (!(v instanceof PDFRef)) stack.push(v)
      }
    }
  }
}

function isJavaScriptAction(context: PDFContext, obj: PDFObject | undefined): boolean {
  const dict = deref(context, obj)
  return dict instanceof PDFDict && dict.lookup(N('S')) === N('JavaScript')
}

function streamType(stream: PDFStream): PDFObject | undefined {
  return stream.dict.lookup(N('Type'))
}

/** Every object reachable from `roots`, references followed. */
function reachable(context: PDFContext, roots: PDFObject[]): Set<PDFObject> {
  const seen = new Set<PDFObject>()
  const stack = [...roots]
  while (stack.length) {
    const o = stack.pop()!
    if (seen.has(o)) continue
    seen.add(o)
    if (o instanceof PDFRef) {
      const target = context.lookup(o)
      if (target) stack.push(target)
    } else if (o instanceof PDFStream) stack.push(o.dict)
    else if (o instanceof PDFDict) for (const [, v] of o.entries()) stack.push(v)
    else if (o instanceof PDFArray) stack.push(...o.asArray())
  }
  return seen
}

const JPEG_METADATA: [number, string][] = [
  [0xe1, 'Exif\0'],
  [0xe1, 'http://ns.adobe.com/xap/1.0/'],
  [0xed, 'Photoshop 3.0'],
]

/** Whether a baseline JPEG carries EXIF, XMP or IPTC segments before its image data. */
function jpegHasMetadata(bytes: Uint8Array): boolean {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return false
  let at = 2
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return false
    const marker = bytes[at + 1]
    if (marker === 0xff) {
      at++
      continue
    }
    if (marker === 0xda || marker === 0xd9) return false
    const length = (bytes[at + 2] << 8) | bytes[at + 3]
    for (const [m, sig] of JPEG_METADATA) {
      if (marker !== m) continue
      let match = true
      for (let i = 0; i < sig.length && match; i++) match = bytes[at + 4 + i] === sig.charCodeAt(i)
      if (match) return true
    }
    at += 2 + length
  }
  return false
}

function isPlainJpeg(stream: PDFStream): boolean {
  const filter = stream.dict.lookup(N('Filter'))
  if (filter === N('DCTDecode')) return true
  return filter instanceof PDFArray && filter.size() === 1 && filter.lookup(0) === N('DCTDecode')
}

/** What the document carries, by kind (kinds with nothing are left out). */
export function inspectMetadata(doc: PDFDocument): MetadataFinding[] {
  const { context } = doc
  const pageOf = new Map<PDFObject, number>()
  doc.getPages().forEach((page, i) => pageOf.set(page.node, i + 1))
  const catalog = doc.catalog

  const found = new Map<MetadataKind, MetadataFinding>()
  const add = (kind: MetadataKind, detail?: string, count = 1) => {
    const f = found.get(kind) ?? { kind, count: 0, details: [] }
    f.count += count
    if (detail && f.details.length < MAX_DETAILS && !f.details.includes(detail)) f.details.push(detail)
    found.set(kind, f)
  }

  const info = deref(context, context.trailerInfo.Info)
  if (info instanceof PDFDict && info.entries().length > 0) {
    found.set('info', { kind: 'info', count: 1, details: info.entries().slice(0, MAX_DETAILS).map(([k, v]) => `${k.decodeText()}: ${text(deref(context, v))}`) })
  }

  // where each XMP stream is attached, and what lies inside application data (counted with it, not separately)
  const xmpHolders = new Map<PDFObject, string>()
  const insidePieceInfo = new Set<PDFObject>()
  const thumbPages: number[] = []
  const embedded = new Set<PDFObject>()
  const attachmentNames: string[] = []
  const describeHolder = (dict: PDFDict): string => {
    if (dict === catalog) return 'the document'
    const page = pageOf.get(dict)
    if (page) return `page ${page}`
    const subtype = dict.lookup(N('Subtype'))
    if (subtype === N('Image')) return 'an image'
    if (subtype === N('Form')) return 'a form XObject'
    const type = dict.lookup(N('Type'))
    if (type === N('FontDescriptor') || type === N('Font')) return 'a font'
    if (dict.has(N('N')) && dict.has(N('Length'))) return 'a colour profile'
    return 'another object'
  }

  walkDicts(context, (dict) => {
    const xmp = deref(context, dict.get(N('Metadata')))
    if (xmp instanceof PDFStream && !xmpHolders.has(xmp)) xmpHolders.set(xmp, describeHolder(dict))
    const piece = dict.get(N('PieceInfo'))
    if (piece) for (const o of reachable(context, [piece])) insidePieceInfo.add(o)
    const page = pageOf.get(dict)
    if (dict.has(N('Thumb'))) thumbPages.push(page ?? 0)
    const ef = deref(context, dict.get(N('EF')))
    if (ef instanceof PDFDict) {
      let any = false
      for (const [, v] of ef.entries()) {
        const file = deref(context, v)
        if (file instanceof PDFStream) {
          embedded.add(file)
          any = true
        }
      }
      if (any) attachmentNames.push(text(deref(context, dict.get(N('UF')) ?? dict.get(N('F')))) || 'unnamed file')
    }
  })

  // second pass: counts that need the sets above
  const xmpStreams = new Set<PDFStream>()
  for (const [, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFStream)) continue
    const type = streamType(object)
    if (type === N('Metadata')) xmpStreams.add(object)
    if (type === N('EmbeddedFile')) embedded.add(object)
    if (object.dict.lookup(N('Subtype')) === N('Image') && isPlainJpeg(object) && jpegHasMetadata(object.getContents())) add('image-metadata')
  }
  for (const s of xmpHolders.keys()) xmpStreams.add(s as PDFStream)
  for (const s of xmpStreams) add('xmp', xmpHolders.has(s) ? `on ${xmpHolders.get(s)}` : 'unreferenced (left over from an earlier edit)')

  walkDicts(context, (dict, holder) => {
    if (insidePieceInfo.has(dict) || insidePieceInfo.has(holder)) return
    const piece = deref(context, dict.get(N('PieceInfo')))
    const where = pageOf.has(dict) ? `page ${pageOf.get(dict)}` : describeHolder(dict)
    if (piece instanceof PDFDict) {
      const apps = piece.entries().map(([k]) => k.decodeText()).join(', ')
      add('piece-info', `${apps || 'application data'} on ${where}`)
    } else if (dict.has(N('LastModified'))) add('piece-info', `a last-modified date on ${where}`)
  })

  if (thumbPages.length) add('thumbnail', thumbPages.some((p) => p > 0) ? `page${thumbPages.length === 1 ? '' : 's'} ${thumbPages.filter((p) => p > 0).join(', ')}` : undefined, thumbPages.length)
  if (embedded.size) {
    found.set('attachments', { kind: 'attachments', count: embedded.size, details: [...new Set(attachmentNames)].slice(0, MAX_DETAILS) })
  }

  walkDicts(context, (dict) => {
    if (dict.lookup(N('S')) === N('JavaScript') || dict.has(N('JS'))) {
      const js = deref(context, dict.get(N('JS')))
      add('javascript', js instanceof PDFStream ? 'a script stored in a stream' : text(js) || 'an empty script')
    }
  })

  const order: MetadataKind[] = ['info', 'xmp', 'piece-info', 'thumbnail', 'attachments', 'javascript', 'image-metadata']
  return order.flatMap((k) => (found.has(k) ? [found.get(k)!] : []))
}

/** Removes `keys` from dict. */
function drop(dict: PDFDict, ...keys: string[]): void {
  for (const k of keys) dict.delete(N(k))
}

/** Strips in place; the caller saves. */
export function stripMetadata(doc: PDFDocument, options: StripMetadataOptions): void {
  const { context } = doc
  const info = context.trailerInfo.Info
  if (info instanceof PDFRef) context.delete(info)
  context.trailerInfo.Info = undefined

  const names = deref(context, doc.catalog.get(N('Names')))
  if (names instanceof PDFDict) {
    if (options.attachments) names.delete(N('EmbeddedFiles'))
    if (options.javascript) names.delete(N('JavaScript'))
    if (names.entries().length === 0) doc.catalog.delete(N('Names'))
  }
  if (options.attachments) doc.catalog.delete(N('Collection'))

  walkDicts(context, (dict) => {
    drop(dict, 'Metadata', 'PieceInfo', 'LastModified', 'Thumb')
    if (options.attachments) {
      drop(dict, 'EF', 'AF')
      const annots = deref(context, dict.get(N('Annots')))
      if (annots instanceof PDFArray) {
        const kept = annots.asArray().filter((a) => {
          const annot = deref(context, a)
          return !(annot instanceof PDFDict && annot.lookup(N('Subtype')) === N('FileAttachment'))
        })
        if (kept.length !== annots.size()) dict.set(N('Annots'), context.obj(kept))
      }
    }
    if (options.javascript) {
      drop(dict, 'JS')
      for (const [key, value] of dict.entries()) {
        if (isJavaScriptAction(context, value)) dict.delete(key)
        else if (key === N('Next')) {
          const next = deref(context, value)
          if (next instanceof PDFArray) {
            const kept = next.asArray().filter((a) => !isJavaScriptAction(context, a))
            if (kept.length !== next.size()) dict.set(key, context.obj(kept))
          }
        }
      }
      const aa = deref(context, dict.get(N('AA')))
      if (aa instanceof PDFDict) {
        for (const [key, value] of aa.entries()) if (isJavaScriptAction(context, value)) aa.delete(key)
        if (aa.entries().length === 0) dict.delete(N('AA'))
      }
    }
  })

  // streams that should now be unreachable go even if something unexpected still points at them
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFStream)) continue
    const type = streamType(object)
    if (type === N('Metadata') || (options.attachments && type === N('EmbeddedFile'))) context.delete(ref)
  }
  collectGarbage(context)
}

/** The raw bytes of each page's content streams, for the before/after comparison. */
function pageContents(doc: PDFDocument): Uint8Array[][] {
  const { context } = doc
  return doc.getPages().map((page) => {
    const contents = deref(context, page.node.get(N('Contents')))
    const streams = contents instanceof PDFArray ? contents.asArray().map((c) => deref(context, c)) : [contents]
    return streams.filter((s): s is PDFStream => s instanceof PDFStream).map((s) => s.getContents())
  })
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function sameContents(a: Uint8Array[][], b: Uint8Array[][]): boolean {
  return a.length === b.length && a.every((page, i) => page.length === b[i].length && page.every((s, j) => sameBytes(s, b[i][j])))
}

export async function removeMetadata(bytes: Uint8Array, options: StripMetadataOptions): Promise<MetadataReport> {
  const doc = await loadPdf(bytes, 'This file', { updateMetadata: false })
  const found = inspectMetadata(doc)
  const before = pageContents(doc)
  const notes: string[] = []

  const acroForm = deref(doc.context, doc.catalog.get(N('AcroForm')))
  if (acroForm instanceof PDFDict && acroForm.has(N('XFA')) && options.javascript) notes.push('This file also has an XFA form, which can carry its own scripts; XFA data is not changed.')
  let authored = 0
  for (const page of doc.getPages()) {
    const annots = deref(doc.context, page.node.get(N('Annots')))
    if (!(annots instanceof PDFArray)) continue
    for (const a of annots.asArray()) {
      const annot = deref(doc.context, a)
      if (annot instanceof PDFDict && annot.has(N('T')) && annot.lookup(N('Subtype')) !== N('Widget')) authored++
    }
  }
  if (authored) notes.push(`${authored} comment${authored === 1 ? '' : 's'} or markup annotation${authored === 1 ? '' : 's'} keep their author name and dates — they are part of the page, and not changed.`)
  if (found.some((f) => f.kind === 'image-metadata')) {
    notes.push('Embedded JPEG photos keep their own EXIF/XMP: images are kept byte for byte. Strip photos before placing them in the document.')
  }

  stripMetadata(doc, options)
  step()
  const out = await doc.save({ useObjectStreams: true, updateFieldAppearances: false })
  step()

  const check = await loadPdf(out, 'The cleaned file', { updateMetadata: false })
  const remain = inspectMetadata(check)
  const contentKept = sameContents(before, pageContents(check))
  const targeted: MetadataKind[] = ['info', 'xmp', 'piece-info', 'thumbnail']
  if (options.attachments) targeted.push('attachments')
  if (options.javascript) targeted.push('javascript')
  return { bytes: out, found, remain, targeted, pages: check.getPageCount(), contentKept, notes }
}

/**
 * pdf-lib's parser with two corrections, used for every document the PDF
 * tools read:
 *
 * 1. pdf-lib ignores the cross-reference table and reads objects in file
 *    order, unpacking every object stream it meets and letting it override
 *    what came before. macOS Preview/PDFKit, re-saving a file that had object
 *    streams, writes every object afresh and leaves the old object stream
 *    behind, unreferenced, *after* them — pdf-lib then puts the stale copies
 *    back and pages come out blank or swapped. An object stream can only be
 *    live when some cross-reference stream can point into it; a file whose
 *    last xref section is a classic table without /XRefStm has none, so
 *    there its object streams are dropped instead of unpacked.
 * 2. A per-object hook, which is where decryption happens (crypt/document.ts):
 *    an encrypted object stream must be decrypted before it is unpacked.
 */
import { PDFContext, PDFDocument, PDFName, PDFObject, PDFObjectStreamParser, PDFParser, PDFRawStream, PDFRef, PDFXRefStreamParser } from 'pdf-lib'

interface ParserInternals {
  context: PDFContext
  parseIndirectObjectHeader(): PDFRef
  skipWhitespaceAndComments(): void
  parseObject(): PDFObject
  matchKeyword(keyword: number[]): boolean
  shouldWaitForTick(): boolean
  parseIndirectObject(): Promise<PDFRef>
}

export type ObjectHook = (ref: PDFRef, object: PDFObject) => Promise<PDFObject>

const ENDOBJ = [...'endobj'].map((c) => c.charCodeAt(0))
const decoder = new TextDecoder('latin1')
const latin1 = (bytes: Uint8Array, from: number, to: number) => decoder.decode(bytes.subarray(Math.max(0, from), to))

/** False when no cross-reference stream can reference compressed objects (see above). */
export function objectStreamsCanBeLive(bytes: Uint8Array): boolean {
  const tail = latin1(bytes, bytes.length - 2048, bytes.length)
  const m = /startxref\s+(\d+)\s*(?:%%EOF)?\s*$/.exec(tail) ?? [...tail.matchAll(/startxref\s+(\d+)/g)].pop()
  if (!m) return true
  const offset = Number(m[1])
  if (!(offset < bytes.length)) return true
  if (!/^\s*xref/.test(latin1(bytes, offset, offset + 16))) return true
  // classic table: compressed objects exist only through a hybrid /XRefStm
  for (let i = 0; i < bytes.length; i += 1 << 20) {
    if (latin1(bytes, i, Math.min(bytes.length, i + (1 << 20) + 8)).includes('/XRefStm')) return true
  }
  return false
}

export async function parsePdf(bytes: Uint8Array, options: { hook?: ObjectHook; unpackObjectStreams: boolean }): Promise<PDFContext> {
  const parser = PDFParser.forBytesWithOptions(bytes, 100)
  const p = parser as unknown as ParserInternals
  const dead: PDFRef[] = []
  p.parseIndirectObject = async () => {
    const ref = p.parseIndirectObjectHeader()
    p.skipWhitespaceAndComments()
    let object = p.parseObject()
    p.skipWhitespaceAndComments()
    p.matchKeyword(ENDOBJ)
    const type = object instanceof PDFRawStream ? object.dict.lookup(PDFName.of('Type')) : undefined
    if (object instanceof PDFRawStream && type === PDFName.of('XRef')) {
      // cross-reference streams are never encrypted, and pdf-lib keeps them out of the document
      PDFXRefStreamParser.forStream(object).parseIntoContext()
      return ref
    }
    if (options.hook) object = await options.hook(ref, object)
    if (object instanceof PDFRawStream && type === PDFName.of('ObjStm')) {
      if (options.unpackObjectStreams) {
        await PDFObjectStreamParser.forStream(object, p.shouldWaitForTick).parseIntoContext()
        return ref
      }
      dead.push(ref)
    }
    p.context.assign(ref, object)
    return ref
  }
  const context = await parser.parseDocument()
  // a dropped object stream is garbage; left in, a later writer could make it look live again
  for (const ref of dead) context.delete(ref)
  return context
}

/** The PDFDocument pdf-lib's own load() would build around a parsed context. */
export function documentFromContext(context: PDFContext): PDFDocument {
  const Doc = PDFDocument as unknown as new (context: PDFContext, ignoreEncryption: boolean, updateMetadata: boolean) => PDFDocument
  return new Doc(context, true, true)
}

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
 *    live when a cross-reference stream in the chain from the last startxref
 *    (through every /Prev and /XRefStm) points into it; the others are
 *    dropped instead of unpacked. A classic-table incremental update on top
 *    of an xref-stream base keeps the base's object streams that way.
 * 2. A per-object hook, which is where decryption happens (crypt/document.ts):
 *    an encrypted object stream must be decrypted before it is unpacked.
 */
import {
  PDFContext,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFObjectParser,
  PDFObjectStreamParser,
  PDFParser,
  PDFRawStream,
  PDFRef,
  PDFXRefStreamParser,
} from 'pdf-lib'

interface ParserInternals {
  context: PDFContext
  parseIndirectObjectHeader(): PDFRef
  skipWhitespaceAndComments(): void
  parseObject(): PDFObject
  matchKeyword(keyword: number[]): boolean
  shouldWaitForTick(): boolean
  parseIndirectObject(): Promise<PDFRef>
}

interface ObjectParserInternals {
  bytes: { moveTo(offset: number): void }
  parseObject(): PDFObject
}

export type ObjectHook = (ref: PDFRef, object: PDFObject) => Promise<PDFObject>

const ENDOBJ = [...'endobj'].map((c) => c.charCodeAt(0))
const decoder = new TextDecoder('latin1')
const latin1 = (bytes: Uint8Array, from: number, to: number) => decoder.decode(bytes.subarray(Math.max(0, from), to))
const CHUNK = 1 << 20

/** Offset of the next `word` at or after `from`, or -1. */
function indexOf(bytes: Uint8Array, word: string, from: number): number {
  for (let at = from; at < bytes.length; at += CHUNK) {
    const i = latin1(bytes, at, Math.min(bytes.length, at + CHUNK + word.length)).indexOf(word)
    if (i >= 0) return at + i
  }
  return -1
}

/**
 * The numbers of the object streams some live cross-reference section
 * points into, found by following the chain from the last startxref through
 * every /Prev and /XRefStm and reading each xref stream's type-2 entries.
 * null when the chain cannot be followed — then every object stream counts,
 * as with pdf-lib's own parser.
 */
export function liveObjectStreams(bytes: Uint8Array): Set<number> | null {
  const tail = latin1(bytes, bytes.length - 2048, bytes.length)
  const m = /startxref\s+(\d+)\s*(?:%%EOF)?\s*$/.exec(tail) ?? [...tail.matchAll(/startxref\s+(\d+)/g)].pop()
  if (!m) return null
  const parser = PDFObjectParser.forBytes(bytes, PDFContext.create()) as unknown as ObjectParserInternals
  const live = new Set<number>()
  const queue = [Number(m[1])]
  const seen = new Set<number>()
  try {
    while (queue.length) {
      const offset = queue.shift()!
      if (seen.has(offset)) continue
      seen.add(offset)
      if (!(offset >= 0 && offset < bytes.length)) return null
      const head = latin1(bytes, offset, offset + 64)
      let dict: PDFDict
      if (/^\s*xref/.test(head)) {
        const at = indexOf(bytes, 'trailer', offset)
        if (at < 0) return null
        parser.bytes.moveTo(at + 'trailer'.length)
        const trailer = parser.parseObject()
        if (!(trailer instanceof PDFDict)) return null
        dict = trailer
        const hybrid = dict.get(PDFName.of('XRefStm'))
        if (hybrid instanceof PDFNumber) queue.push(hybrid.asNumber())
      } else {
        const header = /^\s*\d+\s+\d+\s+obj/.exec(head)
        if (!header) return null
        parser.bytes.moveTo(offset + header[0].length)
        const stream = parser.parseObject()
        if (!(stream instanceof PDFRawStream) || stream.dict.get(PDFName.of('Type')) !== PDFName.of('XRef')) return null
        for (const entry of PDFXRefStreamParser.forStream(stream).parseIntoContext()) if (entry.inObjectStream) live.add(entry.offset)
        dict = stream.dict
      }
      const prev = dict.get(PDFName.of('Prev'))
      if (prev instanceof PDFNumber) queue.push(prev.asNumber())
    }
  } catch {
    return null
  }
  return live
}

/** What parsePdf should unpack for these bytes: the live object streams, or all of them if that is unknowable. */
export function objectStreamsToUnpack(bytes: Uint8Array): true | Set<number> {
  return liveObjectStreams(bytes) ?? true
}

/** unpackObjectStreams: every object stream (true), none (false), or those numbered in the set. */
export async function parsePdf(bytes: Uint8Array, options: { hook?: ObjectHook; unpackObjectStreams: boolean | ReadonlySet<number> }): Promise<PDFContext> {
  const parser = PDFParser.forBytesWithOptions(bytes, 100)
  const p = parser as unknown as ParserInternals
  const unpack = options.unpackObjectStreams
  const isLive = (ref: PDFRef) => (typeof unpack === 'boolean' ? unpack : unpack.has(ref.objectNumber))
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
      if (isLive(ref)) {
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

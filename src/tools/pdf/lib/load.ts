import { PDFArray, PDFDict, PDFName, type PDFContext, type PDFDocument, type PDFObject } from 'pdf-lib'
import { ENCRYPTED_MESSAGE, hasPdfHeader, PdfInputError } from './errors'
import { documentFromContext, objectStreamsToUnpack, parsePdf } from './parse'
import { currentWork, type Work } from './work'

export { describeError, ENCRYPTED_MESSAGE, hasPdfHeader, PdfInputError } from './errors'
export { readBytes } from './files'

/** Deeper than any real page tree (they are a handful of levels); pdf-lib walks it recursively. */
const MAX_PAGE_TREE_DEPTH = 256

/**
 * Walks the page tree once, iteratively, before pdf-lib does: a node reached
 * twice (a tree that contains itself, or shares a subtree — which pdf-lib
 * would walk once per path, exponentially often) or nested past
 * MAX_PAGE_TREE_DEPTH is refused. Every node is visited once, so the walk is
 * linear in the file.
 */
function checkPageTree(context: PDFContext, root: PDFObject | undefined, work: Work): boolean {
  const seen = new Set<PDFObject>()
  const stack: [PDFObject | undefined, number][] = [[root, 0]]
  let visited = 0
  while (stack.length) {
    const [ref, depth] = stack.pop()!
    const node = ref === undefined ? undefined : context.lookup(ref)
    if (!(node instanceof PDFDict) || seen.has(node) || depth > MAX_PAGE_TREE_DEPTH) return false
    seen.add(node)
    if (++visited % 2000 === 0) work.step()
    const kids = node.lookup(PDFName.of('Kids'))
    if (node.lookup(PDFName.of('Type')) === PDFName.of('Pages') || (depth === 0 && kids !== undefined)) {
      if (!(kids instanceof PDFArray)) return false
      for (const kid of kids.asArray()) stack.push([kid, depth + 1])
    }
  }
  return true
}

export interface LoadOptions {
  /** pdf-lib stamps Producer, Creator and dates into the Info dictionary by default; Remove Metadata turns that off. */
  updateMetadata?: boolean
  work?: Work
}

/**
 * Loads a PDF for editing with pdf-lib, refusing what pdf-lib would
 * otherwise turn into a broken file without a word: non-PDFs, unreadable
 * files, and encrypted ones (pdf-lib cannot decrypt, and writing an
 * encrypted file back half-decrypted makes it unopenable).
 */
export async function loadPdf(bytes: Uint8Array, fileName = 'This file', options: LoadOptions = {}): Promise<PDFDocument> {
  if (!hasPdfHeader(bytes)) throw new PdfInputError(`${fileName} is not a PDF.`)
  const work = options.work ?? currentWork()
  let doc: PDFDocument
  try {
    const context = await parsePdf(bytes, { unpackObjectStreams: await objectStreamsToUnpack(bytes, work), work })
    doc = documentFromContext(context, options.updateMetadata ?? true)
  } catch (e) {
    if (e instanceof PdfInputError) throw e
    throw new PdfInputError(`${fileName} could not be read — it may be damaged or truncated.`)
  }
  if (doc.isEncrypted) throw new PdfInputError(fileName === 'This file' ? ENCRYPTED_MESSAGE : `${fileName}: ${ENCRYPTED_MESSAGE}`)
  const damaged = new PdfInputError(`${fileName} could not be read — its page tree is damaged.`)
  if (!checkPageTree(doc.context, doc.catalog.get(PDFName.of('Pages')), work)) throw damaged
  try {
    doc.getPages()
  } catch {
    throw damaged
  }
  return doc
}

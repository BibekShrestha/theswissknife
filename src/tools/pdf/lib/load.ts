import type { PDFDocument } from 'pdf-lib'
import { ENCRYPTED_MESSAGE, hasPdfHeader, PdfInputError } from './errors'
import { documentFromContext, objectStreamsCanBeLive, parsePdf } from './parse'

export { describeError, ENCRYPTED_MESSAGE, hasPdfHeader, PdfInputError } from './errors'

export async function readBytes(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}

/**
 * Loads a PDF for editing with pdf-lib, refusing what pdf-lib would
 * otherwise turn into a broken file without a word: non-PDFs, unreadable
 * files, and encrypted ones (pdf-lib cannot decrypt, and writing an
 * encrypted file back half-decrypted makes it unopenable).
 */
export async function loadPdf(bytes: Uint8Array, fileName = 'This file'): Promise<PDFDocument> {
  if (!hasPdfHeader(bytes)) throw new PdfInputError(`${fileName} is not a PDF.`)
  let doc: PDFDocument
  try {
    doc = documentFromContext(await parsePdf(bytes, { unpackObjectStreams: objectStreamsCanBeLive(bytes) }))
  } catch {
    throw new PdfInputError(`${fileName} could not be read — it may be damaged or truncated.`)
  }
  if (doc.isEncrypted) throw new PdfInputError(fileName === 'This file' ? ENCRYPTED_MESSAGE : `${fileName}: ${ENCRYPTED_MESSAGE}`)
  try {
    doc.getPages()
  } catch {
    throw new PdfInputError(`${fileName} could not be read — its page tree is damaged.`)
  }
  return doc
}

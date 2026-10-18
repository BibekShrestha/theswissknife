/** Protect and Unlock: the Standard security handler in lib/crypt. */
import { encryptDocument, decryptPdf, PdfSecurityError } from '../lib/crypt/document'
import { hasPdfHeader, loadPdf, PdfInputError } from '../lib/load'

/** AES-256 (PDF 2.0, revision 6); the password is needed to open the file. */
export async function protectPdf(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  if (!password) throw new PdfInputError('Enter a password.')
  const doc = await loadPdf(bytes)
  await encryptDocument(doc, password, password)
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false })
}

/** Decrypts with the user or the owner password (empty for owner-only files). */
export async function unlockPdf(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  if (!hasPdfHeader(bytes)) throw new PdfInputError('This file is not a PDF.')
  try {
    return await decryptPdf(bytes, password)
  } catch (e) {
    if (e instanceof PdfSecurityError) throw new PdfInputError(e.message)
    throw new PdfInputError('This PDF could not be read — it may be damaged or truncated.')
  }
}

/** Protect and Unlock: the Standard security handler in lib/crypt. */
import { encryptDocument, decryptPdfReport, PdfSecurityError } from '../lib/crypt/document'
import { hasPdfHeader, loadPdf, PdfInputError } from '../lib/load'

/** AES-256 (PDF 2.0, revision 6); the password is needed to open the file. */
export async function protectPdf(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  if (!password) throw new PdfInputError('Enter a password.')
  const doc = await loadPdf(bytes)
  await encryptDocument(doc, password, password)
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false })
}

export interface UnlockResult {
  bytes: Uint8Array
  /** Set when the file needed no password at all: what was actually removed. */
  note?: string
}

/** Decrypts with the user or the owner password; a file that opens without one is unlocked whatever was typed. */
export async function unlockPdf(bytes: Uint8Array, password: string): Promise<UnlockResult> {
  if (!hasPdfHeader(bytes)) throw new PdfInputError('This file is not a PDF.')
  try {
    const { bytes: out, opened } = await decryptPdfReport(bytes, password)
    if (opened === 'password') return { bytes: out }
    return {
      bytes: out,
      note: password
        ? 'That password did not match, but this PDF opens without one: it only restricted permissions such as printing or editing, and those restrictions are removed.'
        : 'This PDF opens without a password: it only restricted permissions such as printing or editing, and those restrictions are removed.',
    }
  } catch (e) {
    if (e instanceof PdfSecurityError) throw new PdfInputError(e.message)
    if (e instanceof PdfInputError) throw e
    throw new PdfInputError('This PDF could not be read — it may be damaged or truncated.')
  }
}

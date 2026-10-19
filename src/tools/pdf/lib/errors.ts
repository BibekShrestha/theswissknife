/**
 * User-facing errors, kept free of imports so pdf.js-only tools (text,
 * image) can use them without pulling pdf-lib into their chunk.
 */
/** An error whose message is written for the person using the tool. */
export class PdfInputError extends Error {}

export const ENCRYPTED_MESSAGE = 'This PDF is password-protected or encrypted. Remove the protection with Unlock PDF first, then try again.'

/** Fill & Sign's refusal of an XFA-only form, shown by the screen and thrown by the worker. */
export const XFA_ONLY_MESSAGE =
  'This PDF is an XFA form (XML Forms Architecture): its fields live in XFA data that only Adobe Acrobat and Reader draw, and it has no standard form fields to fill. ' +
  'Stamping its pages would not help either — XFA viewers draw the form from that data and ignore the page content. Fill it in Adobe Acrobat or Reader instead.'

export function hasPdfHeader(bytes: Uint8Array): boolean {
  // the spec allows junk before %PDF-, and readers look in the first KB
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024))
  return head.includes('%PDF-')
}

/** The message to show for anything a tool throws. */
export function describeError(e: unknown): string {
  if (e instanceof PdfInputError) return e.message
  if (e instanceof Error && /WinAnsi cannot encode/.test(e.message)) {
    return 'The built-in PDF fonts only cover Western European (Latin-1) characters — remove the other characters and try again.'
  }
  if (e instanceof RangeError) return 'This PDF is too large or too deeply nested to process in the browser.'
  return 'Something went wrong processing this PDF. It may be damaged, or use a feature this tool does not support.'
}

/**
 * Which clipboard flavour a paste into the source pane should use.
 *
 * Copying a rendered table in a browser puts its markup on the clipboard as
 * text/html, and that is what we want. But copying HTML *source* out of a
 * code editor puts the source in text/plain and the editor's own coloured
 * spans in text/html — taking text/html there would load the editor's
 * styling instead of the table. So when the plain text is itself HTML with a
 * table in it, it wins.
 */

const LOOKS_LIKE_TABLE_SOURCE = /<table[\s>]/i

export function pickPaste(html: string, plain: string): { text: string; flavour: 'html' | 'plain' } | null {
  if (LOOKS_LIKE_TABLE_SOURCE.test(plain)) return { text: plain, flavour: 'plain' }
  if (html) return { text: html, flavour: 'html' }
  // Plain text only: the textarea's own paste handles it.
  return null
}

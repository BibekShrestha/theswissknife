/**
 * Elements that start their own line when rendered. Shared by the extractor
 * (which puts a line break where one of these begins or ends inside a cell)
 * and the prettifier (which only ever adds whitespace next to these) — one
 * list, so Prettify can never add whitespace that extraction would keep.
 * Anything not listed, custom elements included, flows inline.
 */
export const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'caption', 'center',
  'col', 'colgroup', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'legend', 'li',
  'listing', 'main', 'menu', 'nav', 'ol', 'p', 'plaintext',
  'pre', 'search', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th',
  'thead', 'tr', 'ul', 'xmp',
])

/** Whitespace as HTML means it — not `\s`, which would also eat &nbsp;. */
export const HTML_SPACE = '[ \\t\\n\\f\\r]'

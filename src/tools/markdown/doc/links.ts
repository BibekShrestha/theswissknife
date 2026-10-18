/**
 * Makes rendered HTML — raw HTML in the Markdown included — unable to move
 * the document it lives in. Used on everything that enters the preview frame
 * and everything that leaves the tool (export, Copy HTML).
 *
 * - External links (any scheme: https, ftp, mailto…) open in a new tab with no
 *   opener. Without a target they would navigate the sandboxed preview frame,
 *   which the site's CSP then blocks, leaving an error page in its place.
 * - `#fragment` links stay in the document (the frame pins its base to
 *   about:srcdoc for that) and lose any target.
 * - Script and data URLs (javascript:, vbscript:, data:) lose their href, on
 *   HTML anchors, image-map areas and SVG links alike.
 * - <meta> (http-equiv refresh), <base>, form actions/targets and `ping` are
 *   removed; forms get method="dialog", which submits nowhere.
 *
 * It works on a parsed tree, not on the string, so it sees exactly the
 * elements a browser would build — markup that only looks malformed to a
 * regex cannot slip past it. The tree comes from a <template>, which parses
 * inertly: nothing loads, refreshes or runs while it is being fixed.
 */

const XLINK = 'http://www.w3.org/1999/xlink'
const DISARMED = new Set(['javascript', 'vbscript', 'data'])

function scheme(href: string): string | null {
  // Browsers ignore embedded whitespace and control characters in schemes.
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(href.replace(/[\u0000- ]/g, ''))
  return m ? m[1].toLowerCase() : null
}

function fixLink(el: Element) {
  const href = el.getAttribute('href') ?? el.getAttributeNS(XLINK, 'href')
  el.removeAttribute('ping')
  if (href === null) return
  const kind = scheme(href)
  if (kind && DISARMED.has(kind)) {
    el.removeAttribute('href')
    el.removeAttributeNS(XLINK, 'href')
    el.removeAttribute('target')
    return
  }
  if (kind) {
    el.setAttribute('target', '_blank')
    el.setAttribute('rel', 'noopener noreferrer')
  } else {
    // A fragment, or a relative path that has nothing to resolve against.
    el.removeAttribute('target')
  }
}

export function disarmTree(root: DocumentFragment | Element): void {
  for (const el of root.querySelectorAll('meta, base')) el.remove()
  for (const el of root.querySelectorAll('a, area')) fixLink(el)
  for (const form of root.querySelectorAll('form')) {
    form.removeAttribute('action')
    form.removeAttribute('target')
    form.setAttribute('method', 'dialog')
  }
  for (const el of root.querySelectorAll('[formaction], [formtarget], [formmethod]')) {
    el.removeAttribute('formaction')
    el.removeAttribute('formtarget')
    el.removeAttribute('formmethod')
  }
}

/** An inert, disarmed fragment of `html`, owned by `doc`. */
export function disarmedFragment(html: string, doc: Document = document): DocumentFragment {
  const template = doc.createElement('template')
  template.innerHTML = html
  disarmTree(template.content)
  return template.content
}

/** `html` with every element above fixed, serialised again. */
export function disarmHtml(html: string, doc: Document = document): string {
  const template = doc.createElement('template')
  template.innerHTML = html
  disarmTree(template.content)
  return template.innerHTML
}

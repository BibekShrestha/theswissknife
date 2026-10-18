import { disarmedFragment } from './links'

/**
 * The preview frame. It is what you see, what prints, and — through
 * buildHtml — what exports, because all three use the same stylesheet.
 *
 * `sandbox` deliberately omits `allow-scripts`: a `<script>` or `onerror`
 * pasted into the Markdown renders as inert markup and never runs, so the tool
 * needs no sanitizer. `allow-same-origin` lets this page write into the frame
 * and call its print(); `allow-modals` is what permits the print dialog;
 * popups let `target=_blank` links open outside the sandbox — and every
 * external link gets that target (links.ts), so none navigates the frame.
 *
 * `<base href="about:srcdoc">`: a srcdoc frame otherwise inherits this page's
 * URL as its base, so `#anchor` would resolve to `/markdown#anchor`, navigate
 * the frame away from the document, and print into the PDF as an external
 * link. Pinning the base keeps fragments in-document; the one thing it costs,
 * root-relative URLs, is handled by `absolutizeUrls` for KaTeX's fonts.
 */

export const FRAME_SANDBOX = 'allow-same-origin allow-modals allow-popups allow-popups-to-escape-sandbox'

export function frameSkeleton(): string {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><base href="about:srcdoc"><title>Document</title>'
    + '<style id="doc-css"></style><style id="extra-css"></style></head>'
    + '<body><main id="doc"></main></body></html>'
}

/**
 * Whether the frame still holds the document frameSkeleton() made. A click
 * that navigates it (a link the disarming missed, a browser quirk) replaces it
 * with another page — usually the CSP's cross-origin error page, whose
 * contentDocument is null — and nothing can be written into it any more; the
 * caller then rebuilds the frame.
 */
export function frameIsLive(frame: HTMLIFrameElement): boolean {
  try {
    const doc = frame.contentDocument
    return Boolean(doc?.getElementById('doc') && doc.querySelector('head > base[href="about:srcdoc"]'))
  } catch {
    return false
  }
}

export interface FrameContent {
  title: string
  body: string
  css: string
  extraCss: string
}

const written = new WeakMap<Document, string>()

/**
 * Updates in place — scroll position and loaded fonts survive each keystroke.
 * The body is disarmed (links.ts) before it is inserted, so a pasted
 * <meta http-equiv="refresh"> never even reaches the live document. Returns
 * false when the frame is no longer ours (see frameIsLive).
 */
export function writeFrame(frame: HTMLIFrameElement, content: FrameContent): boolean {
  if (!frameIsLive(frame)) return false
  const doc = frame.contentDocument!
  const main = doc.getElementById('doc')!
  const css = doc.getElementById('doc-css')
  const extra = doc.getElementById('extra-css')
  if (css && css.textContent !== content.css) css.textContent = content.css
  if (extra && extra.textContent !== content.extraCss) extra.textContent = content.extraCss
  if (written.get(doc) !== content.body) {
    main.replaceChildren(disarmedFragment(content.body, doc))
    written.set(doc, content.body)
  }
  // The print dialog proposes this as the PDF file name.
  doc.title = content.title || 'Document'
  return true
}

/** `url(/assets/x)` → `url(https://site/assets/x)`, so it survives the frame's base. */
export function absolutizeUrls(css: string, origin: string): string {
  return css.replace(/url\((["']?)\/(?!\/)/g, `url($1${origin}/`)
}

/** 0–1 position of a scroller, for proportional scroll sync. */
export function scrollFraction(el: { scrollTop: number; scrollHeight: number; clientHeight: number }): number {
  const room = el.scrollHeight - el.clientHeight
  return room > 0 ? el.scrollTop / room : 0
}

export function frameScroller(frame: HTMLIFrameElement): HTMLElement | null {
  return frame.contentDocument?.scrollingElement as HTMLElement | null ?? null
}

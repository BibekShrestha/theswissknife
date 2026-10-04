import type { MarkedExtension, Tokens } from 'marked'

/**
 * GitHub-style footnotes as a local marked extension — marked core has none.
 *
 * `[^id]` becomes a superscript link numbered in order of first reference;
 * `[^id]: text` (continuation lines indented) is collected rather than
 * rendered in place, and `section()` emits the list at the end of the
 * document. Definitions nobody references are dropped, as GitHub does.
 *
 * State lives in the closure, so each render needs a fresh `footnotes()`.
 */

interface DefToken extends Tokens.Generic {
  type: 'footnoteDef'
  id: string
  tokens: Tokens.Generic[]
}

interface RefToken extends Tokens.Generic {
  type: 'footnoteRef'
  id: string
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Ids go into `id` and `href`, so keep them to a safe alphabet. */
const anchor = (id: string) => id.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-')

export function footnotes() {
  const defs = new Map<string, string>()
  const order: string[] = []

  const extension: MarkedExtension = {
    extensions: [
      {
        name: 'footnoteDef',
        level: 'block',
        start: (src) => src.match(/^\[\^/m)?.index,
        tokenizer(src) {
          const m = /^\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n(?: {2,}|\t)[^\n]*)*)(?:\n+|$)/.exec(src)
          if (!m) return undefined
          const text = m[2].replace(/\n(?: {2,}|\t)/g, '\n')
          return { type: 'footnoteDef', raw: m[0], id: m[1], tokens: this.lexer.inlineTokens(text) } as DefToken
        },
        renderer(token) {
          const t = token as DefToken
          if (!defs.has(t.id)) defs.set(t.id, this.parser.parseInline(t.tokens))
          return ''
        },
      },
      {
        name: 'footnoteRef',
        level: 'inline',
        start: (src) => src.indexOf('[^'),
        tokenizer(src) {
          const m = /^\[\^([^\]\s]+)\](?!:)/.exec(src)
          return m ? ({ type: 'footnoteRef', raw: m[0], id: m[1] } as RefToken) : undefined
        },
        renderer(token) {
          const { id } = token as RefToken
          let n = order.indexOf(id) + 1
          if (!n) n = order.push(id)
          const a = anchor(id)
          return `<sup class="md-fnref"><a href="#fn-${a}" id="fnref-${a}">${n}</a></sup>`
        },
      },
    ],
  }

  /** The footnote list, or '' when nothing was referenced. Call after parsing. */
  function section(): string {
    const items = order
      .filter((id) => defs.has(id))
      .map((id) => {
        const a = anchor(id)
        return `<li id="fn-${a}">${defs.get(id)}<a href="#fnref-${a}" class="md-fnback" aria-label="Back to reference">↩</a></li>`
      })
    return items.length ? `<section class="md-footnotes"><ol>${items.join('')}</ol></section>` : ''
  }

  /** Ids referenced but never defined — the UI can point at the typo. */
  function missing(): string[] {
    return order.filter((id) => !defs.has(id)).map(esc)
  }

  return { extension, section, missing }
}

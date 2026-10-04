import { Marked, type MarkedExtension, type Tokens } from 'marked'
import { footnotes } from './footnotes'
import { escapeHtml, highlight as highlightCode, resolveLang } from './highlight'
import { createSlugger } from './slugger'

/**
 * Markdown → one HTML string, synchronously, every keystroke.
 *
 * Math and mermaid are NOT rendered here: their libraries are megabytes and
 * load lazily. They leave placeholders that carry their source (so the
 * preview shows something sane meanwhile) and that math.ts / mermaid.ts later
 * swap for markup. Nothing here produces script — the preview frame cannot run
 * it anyway, and the exported file forbids it by CSP — but links are still
 * scrubbed so a `javascript:` URL never even reaches the markup.
 */

export interface Heading {
  depth: number
  text: string
  id: string
}

export interface RenderResult {
  html: string
  headings: Heading[]
  title: string
  hasMath: boolean
  hasMermaid: boolean
  /** Footnotes referenced with no definition. */
  missingFootnotes: string[]
}

export interface RenderOptions {
  highlight: boolean
}

/** Attribute-safe escaping; the reverse is `unescapeAttr`. */
export const escapeAttr = escapeHtml

export function unescapeAttr(text: string): string {
  return text.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

/** Inline markup → its visible text, for TOC labels and the title. */
export function plainText(html: string): string {
  return unescapeAttr(html.replace(/<[^>]*>/g, '')).replace(/&#39;/g, "'").trim()
}

const UNSAFE_URL = /^\s*(?:javascript|vbscript|data(?!:image\/(?:png|gif|jpe?g|webp|svg\+xml)[;,])):/i

/** Disarms script-bearing schemes; leaves http, mailto, anchors and relative paths alone. */
export function safeUrl(href: string): string {
  // Browsers ignore embedded whitespace and control characters in schemes.
  return UNSAFE_URL.test(href.replace(/[\u0000- ]/g, '')) ? '#' : href
}

function mathExtension(found: () => void): MarkedExtension {
  return {
    extensions: [
      {
        name: 'mathBlock',
        level: 'block',
        start: (src) => src.match(/^\$\$/m)?.index,
        tokenizer(src) {
          const m = /^\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/.exec(src)
          return m ? { type: 'mathBlock', raw: m[0], text: m[1].trim() } : undefined
        },
        renderer(token) {
          found()
          const tex = escapeAttr(token.text as string)
          return `<div class="md-math-block" data-tex="${tex}">$$${tex}$$</div>\n`
        },
      },
      {
        name: 'mathInline',
        level: 'inline',
        start: (src) => src.indexOf('$'),
        tokenizer(src) {
          // `$x$` but not `$5 and $10`: no space inside the delimiters and no
          // digit straight after the closing one (the pandoc rule).
          const m = /^\$(?!\s)((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/.exec(src)
          return m ? { type: 'mathInline', raw: m[0], text: m[1] } : undefined
        },
        renderer(token) {
          found()
          const tex = escapeAttr(token.text as string)
          return `<span class="md-math" data-tex="${tex}">$${tex}$</span>`
        },
      },
    ],
  }
}

export function renderMarkdown(source: string, options: RenderOptions = { highlight: true }): RenderResult {
  const slug = createSlugger()
  const headings: Heading[] = []
  const notes = footnotes()
  let hasMath = false
  let hasMermaid = false

  const marked = new Marked({ gfm: true, async: false })
  marked.use(notes.extension, mathExtension(() => { hasMath = true }), {
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const inner = this.parser.parseInline(tokens)
        const text = plainText(inner)
        const id = slug(text)
        headings.push({ depth, text, id })
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`
      },
      code({ text, lang }: Tokens.Code) {
        const info = (lang ?? '').trim()
        if (info.split(/\s/)[0].toLowerCase() === 'mermaid') {
          hasMermaid = true
          const src = escapeHtml(text)
          return `<figure class="md-mermaid" data-src="${src}"><pre><code>${src}</code></pre></figure>\n`
        }
        const id = resolveLang(info)
        const body = options.highlight && id ? highlightCode(text, info) : escapeHtml(text)
        const cls = id ? ` class="language-${id}"` : ''
        return `<pre><code${cls}>${body}</code></pre>\n`
      },
      link({ href, title, tokens }: Tokens.Link) {
        const url = safeUrl(href)
        const external = /^https?:\/\//i.test(url)
        const attrs = [
          `href="${escapeAttr(url)}"`,
          title ? `title="${escapeAttr(title)}"` : '',
          external ? 'target="_blank" rel="noopener noreferrer"' : '',
        ].filter(Boolean).join(' ')
        return `<a ${attrs}>${this.parser.parseInline(tokens)}</a>`
      },
      image({ href, title, text }: Tokens.Image) {
        const t = title ? ` title="${escapeAttr(title)}"` : ''
        return `<img src="${escapeAttr(safeUrl(href))}" alt="${escapeAttr(text)}"${t} loading="lazy">`
      },
    },
  })

  let html = marked.parse(source) as string
  // Task lists: marked emits the checkbox but no hook for the <li> itself.
  html = html.replace(/<li>(\s*(?:<p>)?\s*<input (?:checked="" )?disabled="" type="checkbox">)/g, '<li class="task-list-item">$1')
  html += notes.section()

  const h1 = headings.find((h) => h.depth === 1)
  return {
    html,
    headings,
    title: h1?.text ?? '',
    hasMath,
    hasMermaid,
    missingFootnotes: notes.missing(),
  }
}

/** Words, characters and a reading-time estimate, measured on the source. */
export function stats(source: string): { words: number; chars: number; minutes: number } {
  const prose = source
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`~[\]()|-]/g, ' ')
  const words = prose.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu)?.length ?? 0
  return { words, chars: source.length, minutes: Math.max(1, Math.round(words / 230)) }
}

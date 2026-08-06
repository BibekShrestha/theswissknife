/**
 * HTML pretty-printer for the source pane.
 *
 * Token-based on purpose. Round-tripping through DOMParser would "fix" the
 * markup on the way out — a pasted `<tr>` fragment loses its rows, a stray
 * `</div>` disappears, `<tbody>` shows up uninvited — and this button rewrites
 * the user's own source, so it must never change what the markup says. Working
 * from tokens lets us move whitespace between tags and nothing else: tag and
 * attribute names keep their case (SVG needs that), attribute values are copied
 * byte for byte, missing end tags are never invented, and the content of
 * whitespace-sensitive elements is passed through untouched.
 */

export interface FormatOptions {
  /** Spaces per nesting level. */
  indent?: number
  /** Keep an element on one line while the whole line fits in this width. */
  printWidth?: number
}

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
])

/** Content copied through verbatim — reindenting it would change what it means. */
const VERBATIM = new Set(['script', 'style', 'pre', 'textarea', 'title'])

/** Elements that flow with the text around them instead of taking their own line. */
const INLINE = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'big', 'br', 'button', 'cite', 'code', 'data',
  'del', 'dfn', 'em', 'font', 'i', 'img', 'input', 'ins', 'kbd', 'label', 'mark',
  'meter', 'nobr', 'output', 'progress', 'q', 'rp', 'rt', 'ruby', 's', 'samp',
  'select', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'tt', 'u', 'var',
  'wbr',
])

/** A start tag here implies the end of an open `<p>` (HTML's optional end tags). */
const CLOSES_P = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'header', 'hgroup', 'hr', 'main', 'menu', 'nav', 'ol', 'p', 'pre',
  'section', 'table', 'ul',
])

/**
 * Start tag → the open elements it implicitly closes. Without this, the very
 * common `<tr><td>a<td>b` would nest each cell inside the last one and every
 * row would march off to the right.
 */
const IMPLIED_END: Record<string, string[]> = {
  li: ['li'],
  dt: ['dt', 'dd'],
  dd: ['dt', 'dd'],
  option: ['option'],
  optgroup: ['optgroup', 'option'],
  td: ['td', 'th'],
  th: ['td', 'th'],
  tr: ['tr', 'td', 'th'],
  thead: ['tr', 'td', 'th', 'caption', 'colgroup'],
  tbody: ['tr', 'td', 'th', 'caption', 'colgroup', 'thead', 'tbody'],
  tfoot: ['tr', 'td', 'th', 'caption', 'colgroup', 'thead', 'tbody'],
}

/** `\s` would also match &nbsp; (U+00A0) and eat a character of content. */
const SPACE_RUN = /[ \t\r\n\f]+/g

const lower = (s: string) => s.toLowerCase()
const isNameStart = (ch: string) => /[a-zA-Z]/.test(ch)

type Token =
  | { t: 'text'; text: string }
  /** Comment, doctype, or a close tag with nothing to close — kept as written. */
  | { t: 'raw'; text: string }
  | { t: 'close'; name: string; text: string }
  | {
      t: 'open'
      name: string
      text: string
      selfClose: boolean
      /** Set for VERBATIM elements: their whole body, already consumed. */
      verbatim?: string
      closeText?: string
    }

interface Element {
  k: 'el'
  name: string
  open: string
  /** The end tag as written, or null when the source never closed this element. */
  close: string | null
  children: Node[]
  verbatim?: string
  void: boolean
}

type Node = { k: 'text'; text: string } | { k: 'raw'; text: string } | Element

/** Re-emits a start tag from its parts, so odd spacing inside it goes away. */
function parseOpenTag(src: string, start: number): { token: Token; next: number } {
  const len = src.length
  let i = start + 1
  while (i < len && !/[\s/>]/.test(src[i])) i++
  const name = src.slice(start + 1, i)
  const attrs: string[] = []
  let selfClose = false
  let terminated = false

  while (i < len) {
    while (i < len && /\s/.test(src[i])) i++
    if (i >= len) break
    if (src[i] === '>') {
      i++
      terminated = true
      break
    }
    if (src[i] === '/') {
      // `/` only means self-closing right before the `>`; anywhere else it is
      // junk the HTML parser ignores, so we drop it too.
      if (src[i + 1] === '>') {
        selfClose = true
        terminated = true
        i += 2
        break
      }
      i++
      continue
    }

    const nameStart = i
    while (i < len && !/[\s=/>]/.test(src[i])) i++
    let attr = src.slice(nameStart, i)
    const afterName = i
    while (i < len && /\s/.test(src[i])) i++
    if (src[i] === '=') {
      i++
      while (i < len && /\s/.test(src[i])) i++
      const quote = src[i]
      if (quote === '"' || quote === "'") {
        const end = src.indexOf(quote, i + 1)
        const stop = end === -1 ? len : end + 1
        attr += `=${src.slice(i, stop)}`
        i = stop
      } else {
        const valueStart = i
        while (i < len && !/[\s>]/.test(src[i])) i++
        attr += `="${src.slice(valueStart, i)}"`
      }
    } else {
      i = afterName
    }
    if (attr) attrs.push(attr)
  }

  // Truncated at EOF: rebuilding it would have to guess where the quote and the
  // `>` belong, so hand the source back exactly as it came in.
  if (!terminated) return { token: { t: 'raw', text: src.slice(start) }, next: len }

  const text = `<${name}${attrs.length > 0 ? ` ${attrs.join(' ')}` : ''}${selfClose ? ' /' : ''}>`
  return { token: { t: 'open', name, text, selfClose }, next: i }
}

/** Index of `</name`, case-insensitively, ignoring things like `</names>`. */
function findCloseTag(rest: string, name: string): number {
  const haystack = lower(rest)
  const needle = `</${lower(name)}`
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) return -1
    const after = rest[at + needle.length]
    if (after === undefined || after === '>' || after === '/' || /\s/.test(after)) return at
    from = at + needle.length
  }
}

function tokenize(src: string): Token[] {
  const out: Token[] = []
  const len = src.length
  let text = ''
  let i = 0

  const flushText = () => {
    if (text) {
      out.push({ t: 'text', text })
      text = ''
    }
  }

  while (i < len) {
    if (src[i] !== '<') {
      text += src[i]
      i++
      continue
    }

    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4)
      const stop = end === -1 ? len : end + 3
      flushText()
      out.push({ t: 'raw', text: src.slice(i, stop) })
      i = stop
      continue
    }

    // Doctype, CDATA-looking junk, processing instructions.
    if (src[i + 1] === '!' || src[i + 1] === '?') {
      const end = src.indexOf('>', i)
      const stop = end === -1 ? len : end + 1
      flushText()
      out.push({ t: 'raw', text: src.slice(i, stop) })
      i = stop
      continue
    }

    if (src[i + 1] === '/' && isNameStart(src[i + 2] ?? '')) {
      let j = i + 2
      while (j < len && !/[\s>/]/.test(src[j])) j++
      const name = src.slice(i + 2, j)
      const end = src.indexOf('>', j)
      flushText()
      out.push(end === -1 ? { t: 'raw', text: src.slice(i) } : { t: 'close', name, text: `</${name}>` })
      i = end === -1 ? len : end + 1
      continue
    }

    if (isNameStart(src[i + 1] ?? '')) {
      const { token, next } = parseOpenTag(src, i)
      flushText()
      i = next
      if (token.t === 'open' && !token.selfClose && VERBATIM.has(lower(token.name))) {
        const rest = src.slice(i)
        const at = findCloseTag(rest, token.name)
        const body = at === -1 ? rest : rest.slice(0, at)
        let closeText: string | undefined
        if (at === -1) {
          i = len
        } else {
          const end = rest.indexOf('>', at)
          i += end === -1 ? rest.length : end + 1
          closeText = `</${token.name}>`
        }
        out.push({ ...token, verbatim: body, closeText })
        continue
      }
      out.push(token)
      continue
    }

    // A `<` that starts nothing — plain text.
    text += src[i]
    i++
  }

  flushText()
  return out
}

function buildTree(tokens: Token[]): Node[] {
  const root: Node[] = []
  const stack: Element[] = []
  const top = () => stack[stack.length - 1]
  const add = (node: Node) => (top() ? top().children.push(node) : root.push(node))

  for (const tok of tokens) {
    if (tok.t === 'text' || tok.t === 'raw') {
      add({ k: tok.t, text: tok.text })
      continue
    }

    if (tok.t === 'close') {
      const name = lower(tok.name)
      let at = -1
      for (let s = stack.length - 1; s >= 0; s--) {
        if (lower(stack[s].name) === name) {
          at = s
          break
        }
      }
      // Nothing to close: keep the tag rather than quietly dropping markup.
      if (at === -1) {
        add({ k: 'raw', text: tok.text })
        continue
      }
      while (stack.length > at + 1) stack.pop() // these were left unclosed
      stack.pop()!.close = tok.text
      continue
    }

    const name = lower(tok.name)
    const implied = IMPLIED_END[name]
    if (implied) while (stack.length > 0 && implied.includes(lower(top().name))) stack.pop()
    if (CLOSES_P.has(name)) while (stack.length > 0 && lower(top().name) === 'p') stack.pop()

    const el: Element = {
      k: 'el',
      name: tok.name,
      open: tok.text,
      close: tok.closeText ?? null,
      children: [],
      verbatim: tok.verbatim,
      void: tok.selfClose || VOID.has(name),
    }
    add(el)
    if (!el.void && el.verbatim === undefined) stack.push(el)
  }

  return root
}

const collapse = (s: string) => s.replace(SPACE_RUN, ' ')

function isInline(node: Node): boolean {
  if (node.k === 'text') return true
  if (node.k === 'raw') return false
  return node.verbatim === undefined && INLINE.has(lower(node.name))
}

/** One-line form of a run of nodes — used both to test the fit and to emit it. */
function flatten(nodes: Node[]): string {
  let out = ''
  for (const node of nodes) {
    if (node.k === 'text') out += collapse(node.text)
    else if (node.k === 'raw') out += node.text
    else if (node.verbatim !== undefined) out += node.open + node.verbatim + (node.close ?? '')
    else if (node.void) out += node.open
    else out += node.open + flatten(node.children) + (node.close ?? '')
  }
  return out
}

interface Ctx {
  indent: number
  printWidth: number
  out: string[]
}

function renderNodes(nodes: Node[], depth: number, ctx: Ctx) {
  const pad = ' '.repeat(ctx.indent * depth)
  let run: Node[] = []

  const flushRun = () => {
    if (run.length === 0) return
    const line = flatten(run).trim()
    if (line) ctx.out.push(pad + line)
    run = []
  }

  for (const node of nodes) {
    if (isInline(node)) {
      run.push(node)
      continue
    }
    flushRun()
    renderNode(node, depth, ctx)
  }
  flushRun()
}

function renderNode(node: Node, depth: number, ctx: Ctx) {
  const pad = ' '.repeat(ctx.indent * depth)

  if (node.k === 'text') {
    const line = collapse(node.text).trim()
    if (line) ctx.out.push(pad + line)
    return
  }
  if (node.k === 'raw') {
    ctx.out.push(pad + node.text)
    return
  }
  if (node.verbatim !== undefined) {
    ctx.out.push(pad + node.open + node.verbatim + (node.close ?? ''))
    return
  }
  if (node.void || node.children.length === 0) {
    ctx.out.push(pad + node.open + (node.close ?? ''))
    return
  }
  if (node.children.every(isInline)) {
    const line = pad + node.open + flatten(node.children).trim() + (node.close ?? '')
    if (line.length <= ctx.printWidth && !line.includes('\n')) {
      ctx.out.push(line)
      return
    }
  }

  ctx.out.push(pad + node.open)
  renderNodes(node.children, depth + 1, ctx)
  if (node.close) ctx.out.push(pad + node.close)
}

/** Re-indents `src`. Returns '' for blank input; never throws on bad markup. */
export function formatHtml(src: string, options: FormatOptions = {}): string {
  if (!src.trim()) return ''
  const ctx: Ctx = {
    indent: options.indent ?? 2,
    printWidth: options.printWidth ?? 100,
    out: [],
  }
  renderNodes(buildTree(tokenize(src)), 0, ctx)
  return ctx.out.join('\n')
}

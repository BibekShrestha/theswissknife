import { unescapeAttr } from './render'

/**
 * KaTeX, loaded only when a document contains math. render.ts leaves
 * `<span class="md-math" data-tex>` / `<div class="md-math-block" data-tex>`
 * placeholders; `renderMath` swaps them for KaTeX markup, a pure string
 * transform, because the preview frame cannot run KaTeX's own DOM code.
 */

type Katex = typeof import('katex').default

let katexPromise: Promise<Katex> | null = null
let cssPromise: Promise<string> | null = null

export function loadKatex(): Promise<Katex> {
  katexPromise ??= import('katex').then((m) => m.default)
  return katexPromise
}

/** KaTeX's stylesheet with its font URLs already rewritten by Vite to our assets. */
export function loadKatexCss(): Promise<string> {
  cssPromise ??= import('katex/dist/katex.min.css?inline').then((m) => m.default)
  return cssPromise
}

const PLACEHOLDER = /<(span|div) class="md-math(-block)?" data-tex="([^"]*)">[\s\S]*?<\/\1>/g
const cache = new Map<string, string>()

export function renderMath(html: string, katex: Katex): string {
  return html.replace(PLACEHOLDER, (_whole, _tag, block: string | undefined, tex: string) => {
    const key = `${block ? 'D' : 'I'}${tex}`
    let out = cache.get(key)
    if (out === undefined) {
      out = katex.renderToString(unescapeAttr(tex), { displayMode: Boolean(block), throwOnError: false, output: 'htmlAndMathml' })
      if (cache.size > 2000) cache.clear()
      cache.set(key, out)
    }
    return block ? `<div class="md-math-block">${out}</div>` : out
  })
}

/**
 * For the standalone export: keep only the woff2 source of each @font-face
 * and inline it as a data: URI, so the file opens offline with no requests.
 * woff/ttf are fallbacks for browsers that predate woff2 — dropping them
 * keeps the file ~300 KB lighter.
 */
export async function inlineKatexFonts(css: string, fetcher: typeof fetch = fetch): Promise<string> {
  const urls = new Set<string>()
  const trimmed = css.replace(/src:([^;}]*)/g, (whole, list: string) => {
    const woff2 = /url\(([^)]+)\)\s*format\(["']woff2["']\)/.exec(list)
    if (!woff2) return whole
    urls.add(woff2[1])
    return `src:url(${woff2[1]}) format("woff2")`
  })
  const inlined = new Map<string, string>()
  await Promise.all([...urls].map(async (raw) => {
    const url = raw.replace(/^["']|["']$/g, '')
    if (url.startsWith('data:')) return
    const res = await fetcher(url)
    if (!res.ok) throw new Error(`Could not read math font ${url}`)
    inlined.set(raw, `data:font/woff2;base64,${toBase64(new Uint8Array(await res.arrayBuffer()))}`)
  }))
  return trimmed.replace(/url\(([^)]+)\)/g, (whole, raw: string) => inlined.has(raw) ? `url(${inlined.get(raw)})` : whole)
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

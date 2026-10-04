import { escapeHtml } from './highlight'
import { unescapeAttr } from './render'

/**
 * Mermaid, loaded only when a document has a ```mermaid fence. It is the
 * heaviest thing on the site (~1.5 MB), so it renders on an idle debounce
 * from index.tsx, never per keystroke, and every result is cached by source:
 * typing in a paragraph re-uses the SVG instead of re-laying-out a diagram.
 *
 * Rendering happens in this (parent) document — mermaid needs the DOM to
 * measure text — and only the resulting SVG string goes into the frame.
 */

type Mermaid = typeof import('mermaid').default

let mermaidPromise: Promise<Mermaid> | null = null
let counter = 0
const cache = new Map<string, string>()

function load(): Promise<Mermaid> {
  mermaidPromise ??= import('mermaid').then((m) => {
    const mermaid = m.default
    // strict: mermaid sanitises labels and refuses click handlers.
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' })
    return mermaid
  })
  return mermaidPromise
}

const PLACEHOLDER = /<figure class="md-mermaid" data-src="([^"]*)">[\s\S]*?<\/figure>/g

/** Diagram sources in `html` that have no cached render yet. */
export function pendingDiagrams(html: string): string[] {
  const out = new Set<string>()
  for (const m of html.matchAll(PLACEHOLDER)) {
    const src = unescapeAttr(m[1])
    if (!cache.has(src)) out.add(src)
  }
  return [...out]
}

/** Swaps placeholders for cached renders; uncached ones keep their source. */
export function applyDiagrams(html: string): string {
  return html.replace(PLACEHOLDER, (whole, raw: string) => cache.get(unescapeAttr(raw)) ?? whole)
}

let queue: Promise<void> = Promise.resolve()

/**
 * Renders into the cache. Calls are serialised: mermaid keeps global layout
 * state, and two overlapping render() calls corrupt each other's output.
 */
export function renderDiagrams(sources: string[]): Promise<void> {
  if (!sources.length) return Promise.resolve()
  queue = queue.then(() => renderNow(sources))
  return queue
}

async function renderNow(sources: string[]): Promise<void> {
  const mermaid = await load()
  for (const src of sources) {
    if (cache.has(src)) continue
    const id = `md-mermaid-${++counter}`
    try {
      const { svg } = await mermaid.render(id, src)
      cache.set(src, `<figure class="md-mermaid">${svg}</figure>`)
    } catch (e) {
      const message = (e as Error)?.message?.split('\n').filter(Boolean).slice(0, 3).join(' ') || 'Could not render this diagram'
      cache.set(src, `<figure class="md-mermaid md-mermaid-error"><pre><code>${escapeHtml(src)}</code></pre><p>Mermaid: ${escapeHtml(message)}</p></figure>`)
    } finally {
      // A failed render leaves its scratch element behind in <body>.
      document.getElementById(id)?.remove()
      document.getElementById(`d${id}`)?.remove()
    }
  }
  if (cache.size > 200) {
    for (const key of [...cache.keys()].slice(0, cache.size - 200)) cache.delete(key)
  }
}

import { escapeHtml } from './highlight'
import type { Heading } from './render'

/**
 * Headings → a nested `<nav>`. The document title (the first h1) is skipped
 * — a contents list that opens with the page's own title is noise — and so is
 * anything deeper than `depth`. Nesting follows the levels actually present,
 * so a document that jumps from h2 to h4 still nests one step, not two.
 */
export function buildToc(headings: Heading[], depth: number): string {
  const firstH1 = headings.findIndex((h) => h.depth === 1)
  const items = headings.filter((h, i) => i !== firstH1 && h.depth <= depth)
  if (!items.length) return ''

  const base = Math.min(...items.map((h) => h.depth))
  let html = ''
  let level = 0
  for (const h of items) {
    const target = Math.max(1, Math.min(h.depth - base + 1, level + 1))
    if (target > level) {
      html += '<ol>'.repeat(target - level)
    } else {
      html += '</li>'
      html += '</ol></li>'.repeat(level - target)
    }
    level = target
    html += `<li><a href="#${h.id}">${escapeHtml(h.text)}</a>`
  }
  html += '</li>' + '</ol></li>'.repeat(level - 1) + '</ol>'
  return `<nav class="md-toc" aria-label="Contents"><div class="md-toc-title">Contents</div>${html}</nav>`
}

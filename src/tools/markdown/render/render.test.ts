import { describe, expect, it } from 'vitest'
import { plainText, renderMarkdown, safeUrl, stats } from './render'
import { createSlugger } from './slugger'
import { buildToc } from './toc'

const html = (md: string) => renderMarkdown(md).html

describe('GFM', () => {
  it('renders tables, strikethrough and task lists', () => {
    const out = html('| a | b |\n|---|---|\n| 1 | 2 |\n\n~~gone~~\n\n- [x] done\n- [ ] todo\n')
    expect(out).toContain('<table>')
    expect(out).toContain('<del>gone</del>')
    expect(out.match(/<li class="task-list-item">/g)).toHaveLength(2)
    expect(out).toContain('checked=""')
  })

  it('gives headings stable, de-duplicated ids', () => {
    const { headings, html: out } = renderMarkdown('# Title\n## Usage\n## Usage\n### `code` & *more*')
    expect(headings.map((h) => h.id)).toEqual(['title', 'usage', 'usage-2', 'code--more'])
    expect(headings[3].text).toBe('code & more')
    expect(out).toContain('<h2 id="usage-2">')
  })

  it('takes the title from the first h1', () => {
    expect(renderMarkdown('## Not this\n# This one\n# Nor this').title).toBe('This one')
    expect(renderMarkdown('no heading').title).toBe('')
  })

  it('slugs the same way GitHub does for plain text', () => {
    const slug = createSlugger()
    expect(slug("What's new in v2.0?")).toBe('whats-new-in-v20')
    expect(slug('Ünïcode Ok')).toBe('ünïcode-ok')
  })
})

describe('footnotes', () => {
  it('numbers by first reference and lists them at the end', () => {
    const out = html('B[^b] then A[^a] then B again[^b].\n\n[^a]: Alpha *note*.\n[^b]: Beta\n  continued.\n')
    expect(out).toContain('<a href="#fn-b" id="fnref-b">1</a>')
    expect(out).toContain('<a href="#fn-a" id="fnref-a">2</a>')
    const section = out.slice(out.indexOf('<section class="md-footnotes">'))
    expect(section.indexOf('fn-b')).toBeLessThan(section.indexOf('fn-a'))
    expect(section).toContain('Alpha <em>note</em>.')
    expect(section).toContain('Beta\ncontinued.')
  })

  it('reports references without a definition and drops unused ones', () => {
    const r = renderMarkdown('x[^nope]\n\n[^unused]: never cited\n')
    expect(r.missingFootnotes).toEqual(['nope'])
    expect(r.html).not.toContain('never cited')
  })

  it('keeps state per render', () => {
    renderMarkdown('a[^x]\n\n[^x]: one')
    expect(html('b[^y]\n\n[^y]: two')).toContain('>1</a>')
  })
})

describe('math and mermaid placeholders', () => {
  it('marks inline and block math, escaped', () => {
    const r = renderMarkdown('Inline $a<b$ here.\n\n$$\n\\frac{1}{2}\n$$\n')
    expect(r.hasMath).toBe(true)
    expect(r.html).toContain('<span class="md-math" data-tex="a&lt;b">')
    expect(r.html).toContain('<div class="md-math-block" data-tex="\\frac{1}{2}">')
  })

  it('does not treat prices as math', () => {
    const r = renderMarkdown('It costs $5 and $10, or \\$3.')
    expect(r.hasMath).toBe(false)
  })

  it('leaves math alone inside code', () => {
    expect(renderMarkdown('`$x$` and\n\n```\n$$y$$\n```').hasMath).toBe(false)
  })

  it('turns mermaid fences into placeholders carrying their source', () => {
    const r = renderMarkdown('```mermaid\ngraph TD; A-->B\n```')
    expect(r.hasMermaid).toBe(true)
    expect(r.html).toContain('<figure class="md-mermaid" data-src="graph TD; A--&gt;B">')
  })
})

describe('code', () => {
  it('highlights known languages and escapes everything', () => {
    const out = html('```js\nconst a = "<b>"\n```')
    expect(out).toContain('<code class="language-js"><span class="hl-key">const</span>')
    expect(out).toContain('&lt;b&gt;')
    expect(out).not.toContain('<b>')
  })

  it('can switch highlighting off', () => {
    expect(renderMarkdown('```js\nconst a\n```', { highlight: false }).html).not.toContain('hl-key')
  })
})

describe('hostile input', () => {
  // The frame has no allow-scripts and the export has a script-free CSP; these
  // assert the markup itself does not even carry a live script URL.
  it('disarms script URLs in links and images', () => {
    const out = html('[x](javascript:alert(1)) [y](  JaVaScRiPt:alert(1)) [z](vbscript:x) ![i](data:text/html,<script>)')
    expect(out).not.toMatch(/href="\s*javascript:/i)
    expect(out).not.toMatch(/vbscript:/i)
    expect(out).not.toContain('src="data:text/html')
  })

  it('keeps safe schemes', () => {
    expect(safeUrl('https://a.b/c')).toBe('https://a.b/c')
    expect(safeUrl('mailto:a@b.c')).toBe('mailto:a@b.c')
    expect(safeUrl('#top')).toBe('#top')
    expect(safeUrl('data:image/png;base64,AA')).toBe('data:image/png;base64,AA')
    expect(safeUrl('java\tscript:alert(1)')).toBe('#')
  })

  it('opens external links in a new tab without an opener', () => {
    expect(html('[a](https://ex.com)')).toContain('target="_blank" rel="noopener noreferrer"')
    expect(html('[a](#x)')).not.toContain('target=')
  })
})

describe('toc', () => {
  const { headings } = renderMarkdown('# Doc\n## One\n### One.a\n#### deep\n## Two\n')

  it('nests by level and skips the title', () => {
    const toc = buildToc(headings, 3)
    expect(toc).not.toContain('>Doc<')
    expect(toc).toBe('<nav class="md-toc" aria-label="Contents"><div class="md-toc-title">Contents</div>'
      + '<ol><li><a href="#one">One</a><ol><li><a href="#onea">One.a</a></li></ol></li><li><a href="#two">Two</a></li></ol></nav>')
  })

  it('honours depth and is empty when nothing qualifies', () => {
    expect(buildToc(headings, 4)).toContain('#deep')
    expect(buildToc(headings, 2)).not.toContain('One.a')
    expect(buildToc(renderMarkdown('# Only').headings, 3)).toBe('')
  })

  it('nests a skipped level only one step', () => {
    const toc = buildToc(renderMarkdown('## A\n#### B\n## C').headings, 4)
    expect(toc).toContain('<a href="#a">A</a><ol><li><a href="#b">B</a></li></ol></li><li><a href="#c">C</a>')
  })
})

describe('helpers', () => {
  it('strips markup to text', () => {
    expect(plainText('<code>a &amp; b</code>')).toBe('a & b')
  })

  it('counts words outside code fences', () => {
    const s = stats('# Hello world\n\n```\nnot counted at all\n```\n\nit’s fine')
    expect(s.words).toBe(4)
    expect(s.minutes).toBe(1)
  })
})

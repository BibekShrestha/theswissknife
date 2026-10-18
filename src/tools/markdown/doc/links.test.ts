// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { disarmHtml } from './links'

const parse = (html: string) => new DOMParser().parseFromString(`<main>${disarmHtml(html)}</main>`, 'text/html').querySelector('main')!

describe('disarming rendered HTML (MD-1, MD-5)', () => {
  it('sends every external link to a new tab, raw HTML included', () => {
    const out = parse('<a href="https://ex.com">raw</a> <a href="ftp://ex.com/f">ftp</a> <a href="mailto:a@b.c">m</a> <a href="https://ex.com" target="_self">self</a>')
    for (const a of out.querySelectorAll('a')) {
      expect(a.getAttribute('target'), a.textContent!).toBe('_blank')
      expect(a.getAttribute('rel'), a.textContent!).toBe('noopener noreferrer')
    }
  })

  it('keeps in-page anchors in the document', () => {
    const a = parse('<a href="#usage" target="_blank">jump</a>').querySelector('a')!
    expect(a.getAttribute('href')).toBe('#usage')
    expect(a.hasAttribute('target')).toBe(false)
  })

  it('disarms script and data URLs in raw anchors, areas and SVG links', () => {
    const out = parse('<a href="javascript:alert(1)">j</a><a href=" JaVa\tScRiPt:alert(1)">k</a><a href="vbscript:x">v</a><a href="data:text/html,x">d</a>'
      + '<map><area href="javascript:alert(1)"></map><svg><a href="javascript:alert(1)"><text>s</text></a><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>')
    for (const el of out.querySelectorAll('a, area')) {
      expect(el.hasAttribute('href')).toBe(false)
      expect(el.hasAttribute('xlink:href')).toBe(false)
    }
    expect(out.innerHTML).not.toMatch(/javascript:|vbscript:|data:text/i)
  })

  it('removes refresh, base and form targets so the file cannot navigate itself', () => {
    const out = parse('<meta http-equiv="refresh" content="0;url=https://ex.com"><base href="https://ex.com/">'
      + '<form action="https://ex.com/steal" target="_top"><input name="q"><button formaction="https://ex.com/b">go</button></form><a href="https://ex.com" ping="https://ex.com/p">p</a>')
    expect(out.querySelector('meta, base')).toBeNull()
    const form = out.querySelector('form')!
    expect(form.hasAttribute('action')).toBe(false)
    expect(form.hasAttribute('target')).toBe(false)
    expect(form.getAttribute('method')).toBe('dialog')
    expect(out.querySelector('button')!.hasAttribute('formaction')).toBe(false)
    expect(out.querySelector('a')!.hasAttribute('ping')).toBe(false)
  })

  it('leaves ordinary markup and the math and diagram placeholders alone', () => {
    const html = '<p>Hi <span class="md-math" data-tex="a&lt;b">$a&lt;b$</span></p><figure class="md-mermaid" data-src="A--&gt;B"><pre><code>A--&gt;B</code></pre></figure>'
    // Serialisers differ on escaping "<" in attributes, so compare what parses.
    const out = parse(html)
    expect(out.querySelector('span.md-math')!.getAttribute('data-tex')).toBe('a<b')
    expect(out.querySelector('figure.md-mermaid')!.getAttribute('data-src')).toBe('A-->B')
    expect(out.querySelector('p')!.textContent).toBe('Hi $a<b$')
  })
})

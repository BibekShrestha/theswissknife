import { describe, expect, it } from 'vitest'
import { renderMath } from './math'
import { applyDiagrams, pendingDiagrams } from './mermaid'

type Katex = Parameters<typeof renderMath>[1]
const fakeKatex = { renderToString: () => '<b>k</b>' } as unknown as Katex

describe('placeholder swaps run in linear time (MD-3)', () => {
  // Raw HTML can repeat a placeholder's opening tag without ever closing it;
  // a lazy [\s\S]*? would rescan the rest of the document from each one.
  const hostileMath = '<span class="md-math" data-tex="x">'.repeat(20000) + 'tail'
  const hostileDiagram = '<figure class="md-mermaid" data-src="x"><pre><code>'.repeat(20000) + 'tail'

  it('math', () => {
    const start = performance.now()
    renderMath(hostileMath, fakeKatex)
    expect(performance.now() - start).toBeLessThan(150)
    expect(renderMath('<span class="md-math" data-tex="a&lt;b">$a&lt;b$</span>', fakeKatex)).toBe('<b>k</b>')
    expect(renderMath('<div class="md-math-block" data-tex="x">$$x$$</div>', fakeKatex)).toBe('<div class="md-math-block"><b>k</b></div>')
  })

  it('diagrams', () => {
    const start = performance.now()
    pendingDiagrams(hostileDiagram)
    applyDiagrams(hostileDiagram)
    expect(performance.now() - start).toBeLessThan(150)
    expect(pendingDiagrams('<figure class="md-mermaid" data-src="A--&gt;B"><pre><code>A--&gt;B</code></pre></figure>')).toEqual(['A-->B'])
  })
})

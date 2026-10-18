/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { extractTables, type ExtractOptions } from './extract'
import { formatHtml } from './format'
import { pickPaste } from './paste'
import { headerNames, serialize } from './serialize'

const opts = (o: Partial<ExtractOptions> = {}): ExtractOptions => ({ collapseWhitespace: true, links: 'text', ...o })
const rows = (html: string, o?: Partial<ExtractOptions>) => extractTables(html, opts(o))[0].rows

describe('HT-1: JSON keys', () => {
  it('never lets a suffix collide with a real header', () => {
    const names = headerNames({ rows: [['a', 'a', 'a_2'], ['1', '2', '3']], headerRowCount: 1 })
    expect(new Set(names).size).toBe(3)
    expect(names[0]).toBe('a')
    expect(names[2]).toBe('a_2')
    const out = JSON.parse(
      serialize(
        { rows: [['a', 'a', 'a_2'], ['1', '2', '3']], headerRowCount: 1 },
        { format: 'json', delimiter: ',', inferTypes: false, dropEmptyCols: false, dropEmptyRows: false },
      ),
    )
    expect(Object.values(out[0]).sort()).toEqual(['1', '2', '3'])
  })

  it('keeps a __proto__ header as a key', () => {
    const out = JSON.parse(
      serialize(
        { rows: [['__proto__', 'b'], ['1', '2']], headerRowCount: 1 },
        { format: 'json', delimiter: ',', inferTypes: false, dropEmptyCols: false, dropEmptyRows: false },
      ),
    )
    expect(Object.keys(out[0])).toEqual(['__proto__', 'b'])
  })
})

describe('HT-2: cell text reads like the rendered cell', () => {
  it('separates block elements instead of running them together', () => {
    const html = '<table><tr><td><div>Line1</div><div>Line2</div></td><td><p>a</p><p>b</p></td><td><ul><li>x</li><li>y</li></ul></td></tr></table>'
    expect(rows(html)).toEqual([['Line1 Line2', 'a b', 'x y']])
    expect(rows(html, { collapseWhitespace: false })).toEqual([['Line1\nLine2', 'a\nb', 'x\ny']])
  })

  it('skips hidden content', () => {
    const html =
      '<table><tr><td>shown<span style="display:none">secret</span><span hidden>also</span><span aria-hidden="true">icon</span><span style="visibility: hidden">x</span></td></tr></table>'
    expect(rows(html)).toEqual([['shown']])
  })

  it('reads an image by its alt text', () => {
    expect(rows('<table><tr><td><img src="a.png" alt="Yes"> ok</td><td><img src="b.png"></td></tr></table>')).toEqual([
      ['Yes ok', ''],
    ])
  })
})

describe('HT-3: which clipboard flavour a paste uses', () => {
  it('prefers the plain text when it is itself HTML source', () => {
    const editorHtml = '<meta charset="utf-8"><div style="color:#d4d4d4"><span>&lt;table&gt;</span></div>'
    expect(pickPaste(editorHtml, '<table>\n  <tr><td>a</td></tr>\n</table>')).toEqual({
      text: '<table>\n  <tr><td>a</td></tr>\n</table>',
      flavour: 'plain',
    })
  })

  it('takes the rich HTML when a rendered table was copied', () => {
    expect(pickPaste('<table><tr><td>a</td></tr></table>', 'a')).toEqual({
      text: '<table><tr><td>a</td></tr></table>',
      flavour: 'html',
    })
  })

  it('leaves a plain paste to the textarea', () => {
    expect(pickPaste('', 'hello')).toBeNull()
  })
})

describe('HT-4: row groups', () => {
  it('clips a rowspan to its own section', () => {
    const html =
      '<table><thead><tr><th rowspan="0">h</th><th>x</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>'
    expect(rows(html)).toEqual([
      ['h', 'x'],
      ['a', 'b'],
    ])
    const spill =
      '<table><tbody><tr><td rowspan="3">a</td><td>1</td></tr></tbody><tbody><tr><td>b</td><td>2</td></tr></tbody></table>'
    expect(rows(spill)).toEqual([
      ['a', '1'],
      ['b', '2'],
    ])
  })

  it('puts a tfoot written before the body at the bottom, as browsers render it', () => {
    const html =
      '<table><thead><tr><th>h</th></tr></thead><tfoot><tr><td>total</td></tr></tfoot><tbody><tr><td>1</td></tr><tr><td>2</td></tr></tbody></table>'
    expect(rows(html)).toEqual([['h'], ['1'], ['2'], ['total']])
    expect(extractTables(html, opts())[0].headerRowCount).toBe(1)
  })
})

describe('HT-5: Prettify never changes what is extracted', () => {
  const corpus = [
    '<table><tr><td>a   b</td><td>x\ny</td><td>&nbsp;pad&nbsp;</td></tr></table>',
    '<table><tr><td>a<div>b</div>c</td><td><div>x</div>  y  z<div>w</div></td></tr></table>',
    '<table><tr><td>a<custom-el>b</custom-el>c</td><td>a<!--c-->b</td><td>x<font>y</font>z</td></tr></table>',
    '<table><tr><td title=a"b><a href=x"y>link</a></td><td><a href=\'q"r\'>l2</a></td></tr></table>',
    '<table><tr><td><xmp><b>not bold</b></td></tr></table></xmp></td></tr></table>',
    '<table><caption> Rates  2026 </caption><thead><tr><th rowspan=2>C</th><th colspan=2>D</th></tr><tr><th>G</th><th>A</th></tr></thead><tbody><tr><td><a href="/a">Acme</a></td><td>4.50</td><td></td></tr></tbody></table>',
    '<div><p>intro <b>bold</b> text</p><table><tr><td><ul><li>one<li>two</ul></td><td><p>p1<p>p2</td></tr></table></div>',
    '<table><tr><td>' + 'long words '.repeat(20) + '<span>tail</span></td></tr></table>',
    '<table><tr><td><span> lead</span><b>mid </b> end </td><td><pre>  keep\n  me </pre></td></tr></table>',
    '<table><tr><td><textarea>  <td>raw</td> </textarea>after</td></tr></table>',
  ]

  const variants: Partial<ExtractOptions>[] = [
    { collapseWhitespace: true, links: 'text' },
    { collapseWhitespace: false, links: 'text' },
    { collapseWhitespace: false, links: 'both' },
  ]

  it.each(corpus.map((html, i) => [i, html] as const))('corpus #%i', (_i, html) => {
    const pretty = formatHtml(html)
    for (const variant of variants) {
      const before = extractTables(html, opts(variant)).map(({ rows, caption, headerRowCount }) => ({ rows, caption, headerRowCount }))
      const after = extractTables(pretty, opts(variant)).map(({ rows, caption, headerRowCount }) => ({ rows, caption, headerRowCount }))
      expect(after).toEqual(before)
    }
    expect(formatHtml(pretty)).toBe(pretty)
  })

  it('quotes an unquoted value without breaking it', () => {
    expect(formatHtml('<td title=a"b>x</td>')).toBe(`<td title='a"b'>x</td>`)
    expect(formatHtml(`<td title=a"b'c>x</td>`)).toBe('<td title="a&quot;b\'c">x</td>')
  })

  it('copies raw-text elements verbatim', () => {
    expect(formatHtml('<div><xmp><b>x</b>  y</xmp></div>')).toBe('<div>\n  <xmp><b>x</b>  y</xmp>\n</div>')
  })
})

describe('CSV-12 (html-table): Markdown cells are escaped', () => {
  it('does not pass raw HTML through', () => {
    const md = serialize(
      { rows: [['h'], ['<img src=x onerror=alert(1)> & co']], headerRowCount: 1 },
      { format: 'markdown', delimiter: ',', inferTypes: false, dropEmptyCols: false, dropEmptyRows: false },
    )
    expect(md.split('\n')[2]).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; co')
    expect(md).not.toContain('<img')
  })
})

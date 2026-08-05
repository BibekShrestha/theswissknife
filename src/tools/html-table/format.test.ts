import { describe, expect, it } from 'vitest'
import { formatHtml } from './format'

describe('formatHtml', () => {
  it('indents nested block elements and keeps short cells on one line', () => {
    const out = formatHtml('<table><tr><td>4.50</td><td>11.00</td></tr></table>')
    expect(out).toBe(
      [
        '<table>',
        '  <tr>',
        '    <td>4.50</td>',
        '    <td>11.00</td>',
        '  </tr>',
        '</table>',
      ].join('\n'),
    )
  })

  it('flattens a minified page into readable lines', () => {
    const out = formatHtml('<div class="a"><p>Hi <b>there</b></p><ul><li>one<li>two</ul></div>')
    expect(out).toBe(
      [
        '<div class="a">',
        '  <p>Hi <b>there</b></p>',
        '  <ul>',
        '    <li>one',
        '    <li>two',
        '  </ul>',
        '</div>',
      ].join('\n'),
    )
  })

  it('does not nest cells written without end tags', () => {
    // No `</table>` in, no `</table>` out — the indent is the only thing added.
    expect(formatHtml('<table><tr><td>a<td>b<tr><td>c')).toBe(
      ['<table>', '  <tr>', '    <td>a', '    <td>b', '  <tr>', '    <td>c'].join('\n'),
    )
  })

  it('keeps a fragment a fragment — no html/body/tbody invented', () => {
    expect(formatHtml('<tr><td>a</td></tr>')).toBe('<tr>\n  <td>a</td>\n</tr>')
  })

  it('never invents a missing end tag', () => {
    expect(formatHtml('<div><p>hi</div>')).toBe('<div>\n  <p>hi\n</div>')
  })

  it('keeps a close tag that closes nothing', () => {
    expect(formatHtml('<p>a</p></div>')).toBe('<p>a</p>\n</div>')
  })

  it('normalises whitespace inside a tag but not inside its values', () => {
    expect(formatHtml('<td\n   title="two\n   lines"   data-x >z</td>')).toBe(
      '<td title="two\n   lines" data-x>\n  z\n</td>',
    )
    expect(formatHtml('<td   colspan="2"\n  >z</td>')).toBe('<td colspan="2">z</td>')
  })

  it('quotes bare attribute values and preserves attribute name case', () => {
    expect(formatHtml('<img src=a.png width=10 alt>')).toBe('<img src="a.png" width="10" alt>')
    expect(formatHtml('<svg viewBox="0 0 2 2"><path d="M0 0"/></svg>')).toBe(
      '<svg viewBox="0 0 2 2">\n  <path d="M0 0" />\n</svg>',
    )
  })

  it('passes whitespace-sensitive and script content through untouched', () => {
    const src = '<div><pre>  keep\n   me  </pre><script>if (a<b) { x() }</script></div>'
    expect(formatHtml(src)).toBe(
      ['<div>', '  <pre>  keep', '   me  </pre>', '  <script>if (a<b) { x() }</script>', '</div>'].join('\n'),
    )
  })

  it('leaves non-breaking spaces and entities alone', () => {
    expect(formatHtml('<td>a b &amp;  c</td>')).toBe('<td>a b &amp; c</td>')
  })

  it('keeps comments and the doctype on their own lines', () => {
    expect(formatHtml('<!doctype html><!-- note --><p>x</p>')).toBe(
      '<!doctype html>\n<!-- note -->\n<p>x</p>',
    )
  })

  it('breaks a cell that is too wide to keep on one line', () => {
    const long = 'x'.repeat(120)
    expect(formatHtml(`<td>${long}</td>`)).toBe(`<td>\n  ${long}\n</td>`)
  })

  it('is idempotent', () => {
    const src = `<table><caption>Q1</caption><thead><tr><th rowspan="2">Carrier</th><th colspan=2>Domestic</th></tr>
      <tr><th>Ground</th><th>Air</th></tr></thead><tbody><tr><td><a href="https://e.com/a">Acme</a></td><td></td><td>11.00</td></tr></tbody></table>`
    const once = formatHtml(src)
    expect(formatHtml(once)).toBe(once)
    expect(once).toContain('    <td><a href="https://e.com/a">Acme</a></td>')
    expect(once).toContain('<td></td>')
  })

  it('survives junk without throwing', () => {
    expect(formatHtml('  ')).toBe('')
    expect(formatHtml('a < b')).toBe('a < b')
    // Truncated markup comes back byte for byte rather than guessed at.
    expect(formatHtml('<div class="unclosed')).toBe('<div class="unclosed')
    expect(formatHtml('<p>a</p></div')).toBe('<p>a</p>\n</div')
    expect(formatHtml('<!-- unterminated')).toBe('<!-- unterminated')
    expect(formatHtml('</>')).toBe('</>')
  })
})

/**
 * Extraction runs on a real HTML parser, so these tests need a DOM.
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { extractTables, type ExtractOptions } from './extract'

const opts = (o: Partial<ExtractOptions> = {}): ExtractOptions => ({
  collapseWhitespace: true,
  links: 'text',
  ...o,
})

const one = (html: string, o?: Partial<ExtractOptions>) => extractTables(html, opts(o))[0]

describe('basic extraction', () => {
  it('reads a plain table', () => {
    const t = one('<table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>')
    expect(t.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(t.nested).toBe(false)
  })

  it('finds every table in document order', () => {
    const tables = extractTables('<table><tr><td>1</td></tr></table><p>x</p><table><tr><td>2</td></tr></table>', opts())
    expect(tables.map((t) => [t.index, t.rows[0][0]])).toEqual([
      [1, '1'],
      [2, '2'],
    ])
  })

  it('returns nothing for HTML without tables', () => {
    expect(extractTables('<p>no tables here</p>', opts())).toEqual([])
    expect(extractTables('   ', opts())).toEqual([])
  })

  it('survives malformed markup (unclosed tags, implied tbody)', () => {
    const t = one('<table><tr><td>a<td>b<tr><td>c<td>d</table>')
    expect(t.rows).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('pads ragged rows to the widest row', () => {
    const t = one('<table><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>1</td></tr></table>')
    expect(t.rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '', ''],
    ])
  })

  it('picks up the caption', () => {
    const t = one('<table><caption>  Q1   rates </caption><tr><td>a</td></tr></table>')
    expect(t.caption).toBe('Q1 rates')
  })
})

describe('span expansion', () => {
  it('materializes colspan across columns', () => {
    const t = one('<table><tr><td colspan="3">wide</td></tr><tr><td>a</td><td>b</td><td>c</td></tr></table>')
    expect(t.rows).toEqual([
      ['wide', 'wide', 'wide'],
      ['a', 'b', 'c'],
    ])
  })

  it('materializes rowspan down rows, shifting later cells right', () => {
    const t = one(
      '<table><tr><td rowspan="2">side</td><td>a</td></tr><tr><td>b</td></tr></table>',
    )
    expect(t.rows).toEqual([
      ['side', 'a'],
      ['side', 'b'],
    ])
  })

  it('handles a combined colspan+rowspan header block', () => {
    const t = one(`<table>
      <tr><th rowspan="2">Carrier</th><th colspan="2">Domestic</th></tr>
      <tr><th>Ground</th><th>Air</th></tr>
      <tr><td>Acme</td><td>4.50</td><td>11.00</td></tr>
    </table>`)
    expect(t.rows).toEqual([
      ['Carrier', 'Domestic', 'Domestic'],
      ['Carrier', 'Ground', 'Air'],
      ['Acme', '4.50', '11.00'],
    ])
    expect(t.headerRowCount).toBe(2)
  })

  it('treats rowspan="0" as "to the end of the table"', () => {
    const t = one(
      '<table><tr><td rowspan="0">all</td><td>a</td></tr><tr><td>b</td></tr><tr><td>c</td></tr></table>',
    )
    expect(t.rows.map((r) => r[0])).toEqual(['all', 'all', 'all'])
  })

  it('clamps a rowspan that overshoots the table instead of inventing rows', () => {
    const t = one('<table><tr><td rowspan="9999">x</td><td>a</td></tr><tr><td>b</td></tr></table>')
    expect(t.rows).toEqual([
      ['x', 'a'],
      ['x', 'b'],
    ])
  })

  it('ignores nonsense span values', () => {
    const t = one('<table><tr><td colspan="abc">a</td><td rowspan="-3">b</td></tr></table>')
    expect(t.rows).toEqual([['a', 'b']])
  })
})

describe('header detection', () => {
  it('counts <thead> rows', () => {
    const t = one('<table><thead><tr><td>h</td></tr></thead><tbody><tr><td>1</td></tr></tbody></table>')
    expect(t.headerRowCount).toBe(1)
  })

  it('treats a leading all-<th> row as a header', () => {
    const t = one('<table><tr><th>h</th></tr><tr><td>1</td></tr></table>')
    expect(t.headerRowCount).toBe(1)
  })

  it('does not treat a th-per-row key/value table as a header row', () => {
    const t = one('<table><tr><th>Name</th><td>Ada</td></tr><tr><th>Age</th><td>36</td></tr></table>')
    expect(t.headerRowCount).toBe(0)
  })

  it('does not count a th row that appears mid-table', () => {
    const t = one('<table><tr><td>1</td></tr><tr><th>h</th></tr></table>')
    expect(t.headerRowCount).toBe(0)
  })
})

describe('nested tables', () => {
  const html = `<table>
    <tr><td>outer</td><td><table><tr><td>inner</td></tr></table></td></tr>
  </table>`

  it('keeps a nested table out of its parent cell text', () => {
    const [outer] = extractTables(html, opts())
    expect(outer.rows).toEqual([['outer', '']])
  })

  it('reports the nested table separately and flags it', () => {
    const [, inner] = extractTables(html, opts())
    expect(inner.rows).toEqual([['inner']])
    expect(inner.nested).toBe(true)
  })

  it('does not steal rows from a nested table', () => {
    const [outer] = extractTables(
      '<table><tr><td><table><tr><td>x</td></tr><tr><td>y</td></tr></table></td></tr></table>',
      opts(),
    )
    expect(outer.rows.length).toBe(1)
  })
})

describe('cell text', () => {
  it('collapses whitespace and &nbsp; when asked', () => {
    const t = one('<table><tr><td>  a \n\t b&nbsp;&nbsp;c </td></tr></table>')
    expect(t.rows[0][0]).toBe('a b c')
  })

  it('keeps inner line breaks when tidying is off', () => {
    const t = one('<table><tr><td>a<br>b</td></tr></table>', { collapseWhitespace: false })
    expect(t.rows[0][0]).toBe('a\nb')
  })

  it('turns <br> into a space when tidying', () => {
    const t = one('<table><tr><td>a<br>b</td></tr></table>')
    expect(t.rows[0][0]).toBe('a b')
  })

  it('strips script and style content', () => {
    const t = one('<table><tr><td>keep<script>alert(1)</script><style>i{}</style></td></tr></table>')
    expect(t.rows[0][0]).toBe('keep')
  })

  it('reads through inline markup', () => {
    const t = one('<table><tr><td><strong>bo</strong>ld <em>it</em></td></tr></table>')
    expect(t.rows[0][0]).toBe('bold it')
  })
})

describe('link handling', () => {
  const html = '<table><tr><td><a href="/rel/path">Acme</a></td></tr></table>'

  it('uses the link text by default', () => {
    expect(one(html).rows[0][0]).toBe('Acme')
  })

  it('can return the raw href, unresolved against this page', () => {
    expect(one(html, { links: 'url' }).rows[0][0]).toBe('/rel/path')
  })

  it('can return text + URL', () => {
    expect(one(html, { links: 'both' }).rows[0][0]).toBe('Acme (/rel/path)')
  })

  it('does not duplicate when the text already is the URL', () => {
    const t = one('<table><tr><td><a href="https://x.dev">https://x.dev</a></td></tr></table>', {
      links: 'both',
    })
    expect(t.rows[0][0]).toBe('https://x.dev')
  })

  it('handles a link with no text', () => {
    const t = one('<table><tr><td><a href="/x"></a></td></tr></table>', { links: 'both' })
    expect(t.rows[0][0]).toBe('/x')
  })
})

import { describe, expect, it } from 'vitest'
import { highlightRanges } from './Grid'
import { DEFAULT_OPTIONS, parseCsv } from './parse'
import { serialize, toMarkdown, toScalar, uniqueKeys, type SerializeOptions } from './serialize'
import { compareValues, inferType, parseDate } from './view'
import { MAX_BODY_HEIGHT, bodyHeightFor, rowWindow, toScrollTop, toVirtualTop } from './virtual'

const json = (rows: string[][], over: Partial<SerializeOptions>) =>
  JSON.parse(
    serialize(rows, {
      format: 'json',
      delimiter: ',',
      quote: '"',
      headers: null,
      types: ['number'],
      inferTypes: true,
      width: 1,
      ...over,
    }),
  )

describe('CSV-2: inferred JSON numbers never change the value', () => {
  it('keeps values a double cannot hold as strings', () => {
    expect(toScalar('02134', 'number')).toBe('02134')
    expect(toScalar('12345678901234567890', 'number')).toBe('12345678901234567890')
    expect(toScalar('9007199254740993', 'number')).toBe('9007199254740993')
    expect(toScalar('1e400', 'number')).toBe('1e400')
    expect(toScalar('-0', 'number')).toBe('-0')
  })

  it('still converts ordinary numbers', () => {
    expect(toScalar('42', 'number')).toBe(42)
    expect(toScalar('-3.5', 'number')).toBe(-3.5)
    expect(toScalar('1,234.56', 'number')).toBe(1234.56)
    expect(toScalar('1.5e3', 'number')).toBe(1500)
    expect(toScalar('0.25', 'number')).toBe(0.25)
    expect(toScalar('0', 'number')).toBe(0)
  })

  it('survives the whole export', () => {
    const out = json([['02134'], ['12345678901234567890'], ['1e400'], ['7']], { headers: ['zip'] })
    expect(out).toEqual([{ zip: '02134' }, { zip: '12345678901234567890' }, { zip: '1e400' }, { zip: 7 }])
  })
})

describe('CSV-5: JSON keys are unique and every header survives', () => {
  it('does not let a generated suffix collide with a real header', () => {
    const keys = uniqueKeys(['a', 'a', 'a_2'], 3)
    expect(new Set(keys).size).toBe(3)
    expect(keys[0]).toBe('a')
    expect(keys[2]).toBe('a_2')
  })

  it('writes a __proto__ header as an ordinary key', () => {
    const out = json([['1', '2']], { headers: ['__proto__', 'b'], types: ['text', 'text'], width: 2 })
    expect(Object.keys(out[0])).toEqual(['__proto__', 'b'])
    expect(Object.getOwnPropertyDescriptor(out[0], '__proto__')?.value).toBe('1')
  })
})

describe('CSV-6: dates', () => {
  it('reads zone-less dates and date-times on the same clock', () => {
    expect(parseDate('2024-01-01 00:30')! - parseDate('2024-01-01')!).toBe(30 * 60 * 1000)
    expect(compareValues('2024-01-01', '2024-01-01 00:30', 'date')).toBeLessThan(0)
    expect(parseDate('2024-01-01T00:30')).toBe(parseDate('2024-01-01 00:30'))
  })

  it('applies an explicit offset', () => {
    expect(parseDate('2024-01-01T02:00+02:00')).toBe(parseDate('2024-01-01T00:00Z'))
  })

  it('rejects dates that are not on the calendar', () => {
    expect(parseDate('2024-02-30')).toBeNull()
    expect(parseDate('2023-02-29')).toBeNull()
    expect(parseDate('2024-13-01')).toBeNull()
    expect(parseDate('2024-01-01 24:30')).toBeNull()
    expect(parseDate('2024-02-29')).not.toBeNull()
    expect(inferType(['2024-01-01', '2024-02-30'])).toBe('text')
  })
})

describe('CSV-10: boolean columns export one type', () => {
  it('maps every flag spelling the typer accepts', () => {
    expect(inferType(['yes', 'no', '1', '0'])).toBe('boolean')
    expect(['yes', 'no', '1', '0', 'T', 'n'].map((v) => toScalar(v, 'boolean'))).toEqual([
      true, false, true, false, true, false,
    ])
  })
})

describe('CSV-12: Markdown export', () => {
  it('turns a lone CR into a break too', () => {
    expect(toMarkdown([['a\rb']], 1, ['x']).split('\n')[2]).toBe('| a<br>b |')
  })

  it('escapes markup so a cell cannot inject HTML', () => {
    const line = toMarkdown([['<img src=x onerror=alert(1)> & co']], 1, ['<b>h</b>']).split('\n')
    expect(line[0]).toBe('| &lt;b&gt;h&lt;/b&gt; |')
    expect(line[2]).toBe('| &lt;img src=x onerror=alert(1)&gt; &amp; co |')
  })
})

describe('CSV-12: search highlight offsets', () => {
  it('maps matches back when lower-casing changes the length', () => {
    // 'İ'.toLowerCase() is two code units, which used to shift every later mark.
    const text = 'İstanbul abc'
    const [[start, end]] = highlightRanges(text, 'abc', false)
    expect(text.slice(start, end)).toBe('abc')
  })

  it('finds every match in the plain case', () => {
    expect(highlightRanges('abcABC', 'abc', false)).toEqual([[0, 3], [3, 6]])
    expect(highlightRanges('abcABC', 'abc', true)).toEqual([[0, 3]])
  })
})

describe('CSV-3: scrolling past the browser height limit', () => {
  const ROW = 29
  const rows = 1_300_000
  const viewport = 600
  const total = rows * ROW

  it('caps the scrollable height below every browser limit', () => {
    expect(bodyHeightFor(rows, ROW)).toBe(MAX_BODY_HEIGHT)
    expect(MAX_BODY_HEIGHT).toBeLessThan(17_000_000)
    expect(bodyHeightFor(1000, ROW)).toBe(29_000)
  })

  it('is the identity while the file fits', () => {
    expect(toVirtualTop(1234, 29_000, 29_000, viewport)).toBe(1234)
    expect(toScrollTop(1234, 29_000, 29_000, viewport)).toBe(1234)
  })

  it('maps the bottom of the scrollbar to the last row', () => {
    const height = bodyHeightFor(rows, ROW)
    const virtualTop = toVirtualTop(height - viewport, total, height, viewport)
    expect(virtualTop).toBe(total - viewport)
    const { last } = rowWindow(virtualTop, viewport, ROW, rows)
    expect(last).toBe(rows)
  })

  it('round-trips between scroll position and virtual offset', () => {
    const height = bodyHeightFor(rows, ROW)
    for (const virtualTop of [0, 1, 5_000_000, 20_000_000, total - viewport]) {
      const back = toVirtualTop(toScrollTop(virtualTop, total, height, viewport), total, height, viewport)
      expect(Math.abs(back - virtualTop)).toBeLessThan(1e-6 * total)
    }
  })
})

describe('CSV-9: single-column export keeps empty rows', () => {
  it('quotes an empty row so it reads back', () => {
    const out = serialize([[''], ['Ada']], {
      format: 'csv', delimiter: ',', quote: '"', headers: ['name'], types: ['text'], inferTypes: false, width: 1,
    })
    expect(out).toBe('name\n""\nAda')
    expect(parseCsv(out, DEFAULT_OPTIONS).rows).toEqual([['name'], [''], ['Ada']])
  })
})

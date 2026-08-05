import { describe, expect, it } from 'vitest'
import { cleanGrid, coerce, headerNames, serialize, type Grid, type SerializeOptions } from './serialize'

const opts = (o: Partial<SerializeOptions> = {}): SerializeOptions => ({
  format: 'csv',
  delimiter: ',',
  inferTypes: false,
  dropEmptyRows: false,
  dropEmptyCols: false,
  ...o,
})

const grid = (rows: string[][], headerRowCount = 1): Grid => ({ rows, headerRowCount })

describe('cleanGrid', () => {
  it('drops all-empty rows and columns', () => {
    const g = grid(
      [
        ['a', '', 'b'],
        ['1', '', '2'],
        ['', '', ''],
        ['3', '', '4'],
      ],
      1,
    )
    expect(cleanGrid(g, { dropEmptyRows: true, dropEmptyCols: true })).toEqual({
      rows: [
        ['a', 'b'],
        ['1', '2'],
        ['3', '4'],
      ],
      headerRowCount: 1,
    })
  })

  it('keeps blank-looking columns that hold whitespace-only text but drops them as empty', () => {
    const g = grid([['a', '   '], ['1', '\n']], 1)
    expect(cleanGrid(g, { dropEmptyRows: false, dropEmptyCols: true }).rows).toEqual([['a'], ['1']])
  })

  it('decrements the header count when an empty header row is dropped', () => {
    const g = grid([['', ''], ['h1', 'h2'], ['1', '2']], 2)
    const out = cleanGrid(g, { dropEmptyRows: true, dropEmptyCols: false })
    expect(out.rows).toEqual([['h1', 'h2'], ['1', '2']])
    expect(out.headerRowCount).toBe(1)
  })

  it('is a no-op when both switches are off', () => {
    const g = grid([['', ''], ['1', '']], 0)
    expect(cleanGrid(g, { dropEmptyRows: false, dropEmptyCols: false })).toEqual(g)
  })
})

describe('headerNames', () => {
  it('joins multi-row headers and collapses rowspan repeats', () => {
    // what a rowspan+colspan header expands to
    const g = grid(
      [
        ['Carrier', 'Domestic', 'Domestic', 'International', 'International'],
        ['Carrier', 'Ground', 'Air', 'Ground', 'Air'],
        ['Acme', '4.50', '11.00', '18.25', '42.00'],
      ],
      2,
    )
    expect(headerNames(g)).toEqual([
      'Carrier',
      'Domestic Ground',
      'Domestic Air',
      'International Ground',
      'International Air',
    ])
  })

  it('falls back to column_N for blank headers and when there is no header', () => {
    expect(headerNames(grid([['a', '', 'c'], ['1', '2', '3']], 1))).toEqual(['a', 'column_2', 'c'])
    expect(headerNames(grid([['1', '2']], 0))).toEqual(['column_1', 'column_2'])
  })

  it('disambiguates duplicate names so object keys cannot overwrite', () => {
    expect(headerNames(grid([['id', 'name', 'name', 'name']], 1))).toEqual([
      'id',
      'name',
      'name_2',
      'name_3',
    ])
  })
})

describe('coerce', () => {
  it('returns the raw string when inference is off', () => {
    expect(coerce('42', false)).toBe('42')
    expect(coerce('', false)).toBe('')
  })

  it('converts clean scalars', () => {
    expect(coerce('42', true)).toBe(42)
    expect(coerce('-3.5', true)).toBe(-3.5)
    expect(coerce('0', true)).toBe(0)
    expect(coerce('true', true)).toBe(true)
    expect(coerce('false', true)).toBe(false)
    expect(coerce('', true)).toBeNull()
    expect(coerce('  ', true)).toBeNull()
    expect(coerce('null', true)).toBeNull()
  })

  it('types a money column consistently — trailing zeros must not split it', () => {
    // "4.50" and "18.25" sit in the same column; both have to become numbers
    expect(['4.50', '18.25', '0.90', '10.00'].map((v) => coerce(v, true))).toEqual([
      4.5, 18.25, 0.9, 10,
    ])
  })

  it('leaves values a conversion would corrupt as strings', () => {
    expect(coerce('007', true)).toBe('007') // zip codes, ids, part numbers
    expect(coerce('0123', true)).toBe('0123')
    expect(coerce('12345678901234567890', true)).toBe('12345678901234567890') // precision loss
    expect(coerce('1.234567890123456789', true)).toBe('1.234567890123456789')
    expect(coerce('1,234', true)).toBe('1,234')
    expect(coerce('4.50 USD', true)).toBe('4.50 USD')
    expect(coerce('+1', true)).toBe('+1')
    expect(coerce('1e3', true)).toBe('1e3') // plain decimals only
    expect(coerce('Infinity', true)).toBe('Infinity')
  })
})

describe('serialize: csv', () => {
  it('quotes only what needs quoting and doubles inner quotes', () => {
    const g = grid([
      ['plain', 'has,comma', 'has"quote', 'has\nnewline'],
      ['a', 'b', 'c', 'd'],
    ])
    expect(serialize(g, opts())).toBe(
      'plain,"has,comma","has""quote","has\nnewline"\na,b,c,d',
    )
  })

  it('honours an alternate separator', () => {
    // ; is now the separator, so only the ;-bearing field needs quoting
    const g = grid([['a;b', 'c,d']], 0)
    expect(serialize(g, opts({ delimiter: ';' }))).toBe('"a;b";c,d')
  })

  it('returns an empty string for an empty grid', () => {
    expect(serialize(grid([], 0), opts())).toBe('')
  })
})

describe('serialize: tsv', () => {
  it('flattens tabs and newlines because TSV cannot quote them', () => {
    const g = grid([['a\tb', 'c\nd']], 0)
    expect(serialize(g, opts({ format: 'tsv' }))).toBe('a b\tc d')
  })
})

describe('serialize: json', () => {
  it('builds objects keyed by the header, with types inferred', () => {
    const g = grid([
      ['name', 'qty', 'active'],
      ['Widget', '12', 'true'],
      ['Gizmo', '', 'false'],
    ])
    expect(JSON.parse(serialize(g, opts({ format: 'json', inferTypes: true })))).toEqual([
      { name: 'Widget', qty: 12, active: true },
      { name: 'Gizmo', qty: null, active: false },
    ])
  })

  it('keeps everything as strings when inference is off', () => {
    const g = grid([['n'], ['12']])
    expect(JSON.parse(serialize(g, opts({ format: 'json' })))).toEqual([{ n: '12' }])
  })

  it('json-rows keeps the header row as data', () => {
    const g = grid([['a', 'b'], ['1', '2']])
    expect(JSON.parse(serialize(g, opts({ format: 'json-rows', inferTypes: true })))).toEqual([
      ['a', 'b'],
      [1, 2],
    ])
  })
})

describe('serialize: markdown', () => {
  it('emits an aligned table and escapes pipes', () => {
    const g = grid([
      ['name', 'note'],
      ['Acme', 'a|b'],
      ['Borealis Post', 'x'],
    ])
    expect(serialize(g, opts({ format: 'markdown' }))).toBe(
      [
        '| name          | note |',
        '| ------------- | ---- |',
        '| Acme          | a\\|b |',
        '| Borealis Post | x    |',
      ].join('\n'),
    )
  })

  it('uses a blank header row when the table has no header', () => {
    const g = grid([['1', '2']], 0)
    expect(serialize(g, opts({ format: 'markdown' }))).toBe(
      ['|     |     |', '| --- | --- |', '| 1   | 2   |'].join('\n'),
    )
  })
})

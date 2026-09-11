import { describe, expect, it } from 'vitest'
import {
  buildOrder,
  columnName,
  columnTypes,
  compareValues,
  inferType,
  initialWidths,
  looksLikeHeader,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  measureColumn,
  parseNumber,
  type Sort,
} from './view'

describe('parseNumber', () => {
  it('accepts the shapes a spreadsheet actually writes', () => {
    expect(parseNumber('42')).toBe(42)
    expect(parseNumber('-3.5')).toBe(-3.5)
    expect(parseNumber('+7')).toBe(7)
    expect(parseNumber('1,234.56')).toBe(1234.56)
    expect(parseNumber('2.5e3')).toBe(2500)
    expect(parseNumber(' 8 ')).toBe(8)
  })

  it('refuses things that merely contain a number', () => {
    expect(parseNumber('$42')).toBeNull()
    expect(parseNumber('42%')).toBeNull()
    expect(parseNumber('12,34')).toBeNull()
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('n/a')).toBeNull()
  })
})

describe('inferType', () => {
  it('types a column only when every value agrees', () => {
    expect(inferType(['1', '2', '3'])).toBe('number')
    expect(inferType(['2024-01-14', '2023-11-30'])).toBe('date')
    expect(inferType(['true', 'false', 'yes'])).toBe('boolean')
    expect(inferType(['Ada', 'Grace'])).toBe('text')
  })

  /**
   * One "n/a" in a price column makes the whole column text — sorting it as a
   * number would quietly reorder the rows around the value it could not read.
   */
  it('gives up on a column with one unparseable value', () => {
    expect(inferType(['1', '2', 'n/a'])).toBe('text')
  })

  it('ignores blanks rather than letting them decide', () => {
    expect(inferType(['', '1', '  ', '2'])).toBe('number')
    expect(inferType(['', '  '])).toBe('text')
  })

  it('calls a 0/1 column numbers, because that is how people sum it', () => {
    expect(inferType(['0', '1', '1'])).toBe('number')
  })
})

describe('compareValues', () => {
  it('orders numbers by value, not by digits', () => {
    expect(compareValues('9', '10', 'number')).toBeLessThan(0)
    expect(compareValues('9', '10', 'text')).toBeLessThan(0) // numeric collation
    expect(compareValues('b', 'a', 'text')).toBeGreaterThan(0)
  })

  it('orders dates chronologically', () => {
    expect(compareValues('2023-11-30', '2024-01-14', 'date')).toBeLessThan(0)
  })

  /** Empty is absence, not a small value — it belongs at the end either way. */
  it('sends empties last in both directions', () => {
    expect(compareValues('', 'a', 'text')).toBeGreaterThan(0)
    expect(compareValues('a', '', 'text')).toBeLessThan(0)
    expect(compareValues('', '', 'text')).toBe(0)
  })
})

describe('columnName', () => {
  it('names unheaded columns the way a spreadsheet does', () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(columnName)).toEqual([
      'A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA',
    ])
  })
})

describe('looksLikeHeader', () => {
  const rows = (text: string) => text.split('\n').map((line) => line.split(','))

  it('takes a row of words over a row of numbers', () => {
    expect(looksLikeHeader(rows('id,name\n1,Ada'), 2)).toBe(true)
    expect(looksLikeHeader(rows('1,Ada\n2,Grace'), 2)).toBe(false)
  })

  it('does not treat a date row as column names', () => {
    expect(looksLikeHeader(rows('2024-01-14,7\n2024-01-15,9'), 2)).toBe(false)
  })

  it('tolerates one unnamed index column, which exports often have', () => {
    expect(looksLikeHeader(rows(',name,plan\n1,Ada,pro'), 3)).toBe(true)
    expect(looksLikeHeader(rows(',,plan\n1,Ada,pro'), 3)).toBe(false)
  })

  it('will not call a lone row a header of nothing', () => {
    expect(looksLikeHeader(rows('id,name'), 2)).toBe(false)
  })
})

describe('buildOrder', () => {
  const rows = [
    ['name', 'qty'],
    ['Cog', '12'],
    ['Widget', '4'],
    ['Bolt', ''],
  ]
  const types = columnTypes(rows, 2, 1)
  const search = { caseSensitive: false, column: -1 }

  it('types the body without letting the header text vote', () => {
    expect(types).toEqual(['text', 'number'])
  })

  it('lists the body rows in file order when nothing is asked of it', () => {
    expect(buildOrder(rows, 1, '', search, null, types)).toEqual([1, 2, 3])
  })

  it('sorts numerically when the column is numeric, empties last', () => {
    const sort: Sort = { column: 1, direction: 'asc' }
    expect(buildOrder(rows, 1, '', search, sort, types)).toEqual([2, 1, 3])
    expect(buildOrder(rows, 1, '', search, { ...sort, direction: 'desc' }, types)).toEqual([1, 2, 3])
  })

  it('filters on any cell, case-insensitively by default', () => {
    expect(buildOrder(rows, 1, 'wid', search, null, types)).toEqual([2])
    expect(buildOrder(rows, 1, 'WID', search, null, types)).toEqual([2])
    expect(buildOrder(rows, 1, 'wid', { ...search, caseSensitive: true }, null, types)).toEqual([])
  })

  it('can be pinned to one column', () => {
    expect(buildOrder(rows, 1, '12', { ...search, column: 0 }, null, types)).toEqual([])
    expect(buildOrder(rows, 1, '12', { ...search, column: 1 }, null, types)).toEqual([1])
  })

  it('never returns the header row as data', () => {
    expect(buildOrder(rows, 1, 'name', search, null, types)).toEqual([])
  })
})

describe('measureColumn and initialWidths', () => {
  const rows = [
    ['id', 'description'],
    ['1', 'a fairly long description that should win the column'],
    ['2', 'short'],
  ]

  it('sizes a column from its widest sampled value', () => {
    const [id, description] = initialWidths(rows, 2, 1)
    expect(description).toBeGreaterThan(id)
  })

  it('stays inside the bounds the grid can lay out', () => {
    expect(measureColumn([['x']], 0, 0, 'x')).toBe(MIN_COLUMN_WIDTH)
    expect(measureColumn([['y'.repeat(5000)]], 0, 0, '')).toBe(MAX_COLUMN_WIDTH)
  })

  it('counts the header text, so a wide name is not clipped', () => {
    expect(measureColumn([['a_very_wide_column_name'], ['1']], 1, 0, 'a_very_wide_column_name'))
      .toBeGreaterThan(MIN_COLUMN_WIDTH)
  })
})

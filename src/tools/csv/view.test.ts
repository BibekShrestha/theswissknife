import { describe, expect, it } from 'vitest'
import {
  applyFilters,
  buildOrder,
  groupedDisplay,
  groupIndex,
  groupRows,
  isGroupHeader,
  matchesFilter,
  profileColumns,
  topValues,
  type Filter,
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
    expect(measureColumn([['x']], 0, 0, '')).toBe(MIN_COLUMN_WIDTH)
    expect(measureColumn([['y'.repeat(5000)]], 0, 0, '')).toBe(MAX_COLUMN_WIDTH)
  })

  it('counts the header text, so a wide name is not clipped', () => {
    expect(measureColumn([['a_very_wide_column_name'], ['1']], 1, 0, 'a_very_wide_column_name'))
      .toBeGreaterThan(MIN_COLUMN_WIDTH)
  })

  it('leaves room for the type mark and filter button beside a short name', () => {
    expect(measureColumn([['plan'], ['pro']], 1, 0, 'plan')).toBeGreaterThan(measureColumn([['plan'], ['pro']], 1, 0, ''))
  })
})

describe('column filters', () => {
  const rows = [
    ['name', 'plan', 'mrr', 'signed_up'],
    ['Ada', 'pro', '49.00', '2024-01-14'],
    ['Grace', 'free', '0', '2023-11-30'],
    ['Linus', 'Pro', '199', ''],
    ['Ken', '', '9.5', '2024-05-11'],
  ]
  const types = columnTypes(rows, 4, 1)
  const all = [1, 2, 3, 4]
  const keep = (filters: Filter[], caseSensitive = false) => applyFilters(rows, all, filters, types, caseSensitive)

  it('compares by the column type, not as text', () => {
    expect(types[2]).toBe('number')
    expect(keep([{ column: 2, op: 'gt', value: '9' }])).toEqual([1, 3, 4])
    expect(keep([{ column: 2, op: 'equals', value: '49' }])).toEqual([1])
    expect(keep([{ column: 3, op: 'lt', value: '2024-01-01' }])).toEqual([2])
  })

  it('follows case sensitivity for text tests', () => {
    expect(keep([{ column: 1, op: 'equals', value: 'pro' }])).toEqual([1, 3])
    expect(keep([{ column: 1, op: 'equals', value: 'pro' }], true)).toEqual([1])
    expect(keep([{ column: 0, op: 'starts', value: 'g' }])).toEqual([2])
  })

  it('treats blanks as absence', () => {
    expect(keep([{ column: 3, op: 'lt', value: '2099-01-01' }])).toEqual([1, 2, 4])
    expect(keep([{ column: 1, op: 'empty', value: '' }])).toEqual([4])
    expect(keep([{ column: 1, op: 'not-empty', value: '' }])).toEqual([1, 2, 3])
    expect(keep([{ column: 1, op: 'not-equals', value: 'free' }])).toEqual([1, 3, 4])
  })

  it('ANDs filters and ignores one still waiting for a value', () => {
    expect(keep([{ column: 1, op: 'contains', value: 'pro' }, { column: 2, op: 'lt', value: '100' }])).toEqual([1])
    expect(keep([{ column: 0, op: 'contains', value: '' }])).toEqual(all)
    expect(matchesFilter('x', { column: 0, op: 'gt', value: '' }, 'number', false)).toBe(true)
  })
})

describe('grouping', () => {
  const rows = [
    ['plan', 'mrr', 'id'],
    ['pro', '49', '1'],
    ['free', '0', '2'],
    ['', '5', '3'],
    ['pro', '51', '4'],
    ['team', '199', '5'],
  ]
  const types = columnTypes(rows, 3, 1)

  it('groups by exact value, blanks last, keeping row order within a group', () => {
    const groups = groupRows(rows, [5, 4, 3, 2, 1], 0, types, null)
    expect(groups.map((group) => group.value)).toEqual(['free', 'pro', 'team', ''])
    expect(groups[1].rows).toEqual([4, 1])
  })

  it('sums every other number column', () => {
    const groups = groupRows(rows, [1, 2, 3, 4, 5], 0, types, null)
    expect(groups[1].sums.get(1)).toBe(100)
    expect(groups[1].sums.get(2)).toBe(5)
    expect(groups[1].sums.has(0)).toBe(false)
  })

  it('orders groups by type and follows a sort on the same column', () => {
    const asc = groupRows(rows, [1, 2, 3, 4, 5], 1, types, null)
    expect(asc.map((group) => group.value)).toEqual(['0', '5', '49', '51', '199'])
    const desc = groupRows(rows, [1, 2, 3, 4, 5], 1, types, { column: 1, direction: 'desc' })
    expect(desc[0].value).toBe('199')
  })

  it('lays out headers and hides collapsed rows', () => {
    const groups = groupRows(rows, [1, 2, 3, 4, 5], 0, types, null)
    const display = groupedDisplay(groups, new Set(['pro']))
    expect(display.filter(isGroupHeader).map(groupIndex)).toEqual([0, 1, 2, 3])
    expect(display.filter((item) => !isGroupHeader(item))).toEqual([2, 5, 3])
  })
})

describe('topValues', () => {
  it('lists the most common non-blank values first, skipping the header', () => {
    const rows = [['plan'], ['pro'], ['free'], ['pro'], [''], ['team'], ['pro'], ['free']]
    expect(topValues(rows, 1, 0, 2)).toEqual([
      { value: 'pro', count: 3 },
      { value: 'free', count: 2 },
    ])
  })
})

describe('profileColumns', () => {
  const rows = [['id', 'plan', 'note'], ['1', 'pro', ''], ['2', 'free', ''], ['3', 'pro', ''], ['4', 'pro', '']]

  it('counts distinct values, previews the common ones and spots unique columns', () => {
    const [id, plan, note] = profileColumns(rows, 1, 3, 1000)
    expect(id).toMatchObject({ distinct: 4, unique: true, capped: false })
    expect(plan).toMatchObject({ distinct: 2, unique: false, top: ['pro', 'free'] })
    expect(note).toMatchObject({ distinct: 0, unique: false, top: [] })
  })

  it('stops counting at the cap, and reads only the rows it is allowed', () => {
    expect(profileColumns(rows, 1, 1, 1000, 2)[0]).toMatchObject({ distinct: 2, capped: true, unique: false })
    expect(profileColumns(rows, 1, 2, 2)[1].distinct).toBe(2)
  })
})

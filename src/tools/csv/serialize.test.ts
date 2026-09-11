import { describe, expect, it } from 'vitest'
import { quoteField, serialize, toMarkdown, uniqueKeys, type SerializeOptions } from './serialize'
import type { ColumnType } from './view'

const options = (over: Partial<SerializeOptions> = {}): SerializeOptions => ({
  format: 'csv',
  delimiter: ',',
  quote: '"',
  headers: ['name', 'qty'],
  types: ['text', 'number'] as ColumnType[],
  inferTypes: true,
  width: 2,
  ...over,
})

const rows = [
  ['Cog', '12'],
  ['Widget, large', '4'],
]

describe('quoteField', () => {
  it('quotes only what would otherwise come back different', () => {
    expect(quoteField('plain', ',', '"')).toBe('plain')
    expect(quoteField('a,b', ',', '"')).toBe('"a,b"')
    expect(quoteField('say "hi"', ',', '"')).toBe('"say ""hi"""')
    expect(quoteField('two\nlines', ',', '"')).toBe('"two\nlines"')
    expect(quoteField(' padded ', ',', '"')).toBe('" padded "')
  })

  it('leaves a value alone when quoting is switched off', () => {
    expect(quoteField('a,b', ',', '')).toBe('a,b')
  })
})

describe('serialize', () => {
  it('writes CSV back with the header and the separator in use', () => {
    expect(serialize(rows, options())).toBe('name,qty\nCog,12\n"Widget, large",4')
    expect(serialize(rows, options({ delimiter: ';' }))).toBe('name;qty\nCog;12\nWidget, large;4')
  })

  it('writes TSV regardless of the separator the file came in with', () => {
    expect(serialize(rows, options({ format: 'tsv', delimiter: ';' }))).toBe(
      'name\tqty\nCog\t12\nWidget, large\t4',
    )
  })

  it('leaves the header row out when the file has none', () => {
    expect(serialize(rows, options({ headers: null }))).toBe('Cog,12\n"Widget, large",4')
  })

  it('builds JSON objects from the header, with real scalars', () => {
    expect(JSON.parse(serialize(rows, options({ format: 'json' })))).toEqual([
      { name: 'Cog', qty: 12 },
      { name: 'Widget, large', qty: 4 },
    ])
  })

  it('keeps everything a string when type inference is off', () => {
    expect(JSON.parse(serialize(rows, options({ format: 'json', inferTypes: false })))).toEqual([
      { name: 'Cog', qty: '12' },
      { name: 'Widget, large', qty: '4' },
    ])
  })

  it('writes blanks as null rather than empty strings', () => {
    expect(JSON.parse(serialize([['Bolt', '']], options({ format: 'json' })))).toEqual([
      { name: 'Bolt', qty: null },
    ])
  })

  it('writes arrays for JSON rows, and names columns when there is no header', () => {
    expect(JSON.parse(serialize(rows, options({ format: 'json-rows' })))).toEqual([
      ['Cog', 12],
      ['Widget, large', 4],
    ])
    expect(JSON.parse(serialize(rows, options({ format: 'json', headers: null })))[0]).toEqual({
      A: 'Cog',
      B: 12,
    })
  })

  it('pads short rows to the full width so columns stay aligned', () => {
    expect(serialize([['Cog']], options())).toBe('name,qty\nCog,')
  })
})

describe('uniqueKeys', () => {
  /** Two "name" columns would silently overwrite each other in an object. */
  it('keeps duplicate headers distinguishable', () => {
    expect(uniqueKeys(['name', 'name', 'name'], 3)).toEqual(['name', 'name_2', 'name_3'])
  })

  it('names blank headers after their position', () => {
    expect(uniqueKeys(['', 'qty'], 2)).toEqual(['A', 'qty'])
  })
})

describe('toMarkdown', () => {
  it('escapes pipes and newlines so the table survives', () => {
    expect(toMarkdown([['a|b', 'two\nlines']], 2, ['x', 'y'])).toBe(
      '| x | y |\n| --- | --- |\n| a\\|b | two<br>lines |',
    )
  })

  it('falls back to column letters with no header', () => {
    expect(toMarkdown([['1', '2']], 2, null).split('\n')[0]).toBe('| A | B |')
  })
})

import { describe, expect, it } from 'vitest'
import { DEFAULT_OPTIONS, detectDelimiter, parseCsv, type ParseOptions } from './parse'

const parse = (text: string, options: Partial<ParseOptions> = {}) =>
  parseCsv(text, { ...DEFAULT_OPTIONS, ...options })

describe('parseCsv', () => {
  it('reads plain rows and reports the widest one', () => {
    const { rows, width } = parse('a,b\n1,2\n3,4')
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
    expect(width).toBe(2)
  })

  it('keeps delimiters, newlines and doubled quotes inside a quoted field', () => {
    const { rows } = parse('name,note\n"Alvarez, R","said ""no"" twice\nthen left"')
    expect(rows[1]).toEqual(['Alvarez, R', 'said "no" twice\nthen left'])
  })

  it('handles CRLF, CR and LF line endings alike', () => {
    expect(parse('a,b\r\n1,2\r\n').rows).toEqual([['a', 'b'], ['1', '2']])
    expect(parse('a,b\r1,2').rows).toEqual([['a', 'b'], ['1', '2']])
  })

  /** A trailing separator means one more empty field, not the end of the row. */
  it('keeps the empty field a trailing separator implies', () => {
    expect(parse('a,b,').rows).toEqual([['a', 'b', '']])
    expect(parse('a,,b').rows).toEqual([['a', '', 'b']])
  })

  it('does not invent a row after a trailing newline', () => {
    expect(parse('a,b\n').rows).toEqual([['a', 'b']])
  })

  it('skips blank lines only when asked', () => {
    expect(parse('a,b\n\n1,2').rows).toEqual([['a', 'b'], ['1', '2']])
    expect(parse('a,b\n\n1,2', { skipEmptyLines: false }).rows).toEqual([
      ['a', 'b'],
      [''],
      ['1', '2'],
    ])
  })

  it('treats quotes as ordinary text when there is no quote character', () => {
    expect(parse('a,"b,c"', { quote: '' }).rows).toEqual([['a', '"b', 'c"']])
  })

  it('skips comment lines only at the start of a row', () => {
    const { rows } = parse('# generated\na,b\n1,#2', { comment: '#' })
    expect(rows).toEqual([['a', 'b'], ['1', '#2']])
  })

  it('trims fields on request, without touching quoted content', () => {
    expect(parse('a , b \n" c ", d', { trim: true }).rows).toEqual([['a', 'b'], ['c', 'd']])
  })

  /**
   * The honest part. A viewer that silently drops the tail of a broken file is
   * worse than one that shows the mess and says where it is.
   */
  it('reports an unterminated quote and keeps the text it swallowed', () => {
    const { rows, issues } = parse('a,b\n"oops,2\n3,4')
    expect(issues).toContainEqual(
      expect.objectContaining({ kind: 'unterminated-quote', row: 1 }),
    )
    expect(rows[1][0]).toBe('oops,2\n3,4')
  })

  it('keeps characters that follow a closing quote instead of dropping them', () => {
    expect(parse('"a"b,c').rows).toEqual([['ab', 'c']])
  })

  it('counts ragged rows against the first row and points at the first one', () => {
    const { issues, raggedRows, width } = parse('a,b,c\n1,2,3\n4,5\n6,7,8,9')
    expect(raggedRows).toBe(2)
    expect(width).toBe(4)
    expect(issues[0]).toEqual({ row: 2, kind: 'ragged', detail: '2 fields, expected 3' })
  })

  it('caps the issue list but not the ragged count', () => {
    const broken = ['a,b', ...Array.from({ length: 200 }, () => '1')].join('\n')
    const { issues, raggedRows } = parse(broken)
    expect(raggedRows).toBe(200)
    expect(issues.length).toBeLessThanOrEqual(40)
  })

  it('reads an empty input as nothing at all', () => {
    expect(parse('')).toEqual({ rows: [], width: 0, issues: [], raggedRows: 0 })
  })
})

describe('detectDelimiter', () => {
  it('finds the separator that splits the sample consistently', () => {
    expect(detectDelimiter('a,b,c\n1,2,3').delimiter).toBe(',')
    expect(detectDelimiter('a;b;c\n1;2;3').delimiter).toBe(';')
    expect(detectDelimiter('a\tb\tc\n1\t2\t3').delimiter).toBe('\t')
    expect(detectDelimiter('a|b|c\n1|2|3').delimiter).toBe('|')
  })

  /** Excel and Sheets both put tab-separated text on the clipboard. */
  it('picks tabs out of a pasted spreadsheet selection', () => {
    expect(detectDelimiter('Name\tQty\nWidget\t4\nCog\t12').delimiter).toBe('\t')
  })

  it('ignores separators that only appear inside quoted fields', () => {
    expect(detectDelimiter('name;note\nAda;"one, two"\nGrace;"three, four"').delimiter).toBe(';')
  })

  /** Frequency alone would pick the comma out of "1,5;2,3" every time. */
  it('prefers consistency over raw frequency', () => {
    const european = 'price;weight\n1,5;2,3\n4,25;6,125\n7,5;8,75'
    expect(detectDelimiter(european).delimiter).toBe(';')
  })

  it('admits when nothing splits the text', () => {
    const detection = detectDelimiter('just one line\nand another')
    expect(detection.found).toBe(false)
    expect(detection.delimiter).toBe(',')
  })

  it('names the equally good candidates rather than hiding the ambiguity', () => {
    const both = 'a,b;c\nd,e;f\ng,h;i'
    const detection = detectDelimiter(both)
    expect([detection.delimiter, ...detection.alternatives].sort()).toEqual([',', ';'])
  })
})

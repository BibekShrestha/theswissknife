import { describe, expect, it } from 'vitest'
import { parse as parseYamlLib } from 'yaml'
import { parse as parseTomlLib } from 'smol-toml'
import { convert, detectFormat, parseJson, tomlHasComment, type ConvertOptions, type Format } from './convert'

const opts = (from: ConvertOptions['from'], to: Format, extra: Partial<ConvertOptions> = {}): ConvertOptions =>
  ({ from, to, indent: 2, sortKeys: false, ...extra })

const run = (text: string, from: ConvertOptions['from'], to: Format, extra?: Partial<ConvertOptions>) => convert(text, opts(from, to, extra))
const ok = (text: string, from: ConvertOptions['from'], to: Format, extra?: Partial<ConvertOptions>) => {
  const result = run(text, from, to, extra)
  expect(result.error).toBeUndefined()
  return result
}
const noteText = (result: ReturnType<typeof convert>) => result.notes.map((note) => `${note.text} ${(note.items ?? []).join(' | ')}`).join('\n')

const JSON_DOC = `{
  "name": "knife",
  "version": 3,
  "ratio": 1.5,
  "whole": 2.0,
  "on": true,
  "tags": ["a", "b"],
  "owner": { "first": "Ada", "nested": { "deep": [1, 2, { "x": "y" }] } },
  "servers": [{ "host": "a", "port": 80 }, { "host": "b", "port": 443 }]
}
`

describe('round trips', () => {
  const pairs: [Format, Format][] = [['json', 'yaml'], ['json', 'toml'], ['yaml', 'toml']]
  for (const [a, b] of pairs) {
    it(`${a} → ${b} → ${a} keeps the data`, () => {
      const start = a === 'json' ? JSON_DOC : ok(JSON_DOC, 'json', a).output
      const there = ok(start, a, b).output
      const back = ok(there, b, a).output
      expect(ok(back, a, 'json').output).toBe(ok(start, a, 'json').output)
    })
  }

  it('keeps floats that look like integers as floats', () => {
    expect(ok('a = 1.0\nb = 1\n', 'toml', 'json').output).toBe('{\n  "a": 1.0,\n  "b": 1\n}\n')
    expect(ok('a = 1.0\nb = 1\n', 'toml', 'yaml').output).toBe('a: 1.0\nb: 1\n')
    expect(ok('{"a": 1.0, "b": 1}', 'json', 'toml').output).toBe('a = 1.0\nb = 1\n')
  })

  it('the YAML and TOML it writes are read back identically by the libraries', () => {
    const yaml = ok(JSON_DOC, 'json', 'yaml').output
    expect(parseYamlLib(yaml)).toEqual(JSON.parse(JSON_DOC))
    const toml = ok(JSON_DOC, 'json', 'toml').output
    expect(parseTomlLib(toml)).toEqual(JSON.parse(JSON_DOC))
  })

  it('indents JSON and YAML by 2 or 4', () => {
    expect(ok('{"a":{"b":1}}', 'json', 'json', { indent: 4 }).output).toBe('{\n    "a": {\n        "b": 1\n    }\n}\n')
    expect(ok('{"a":{"b":1}}', 'json', 'yaml', { indent: 4 }).output).toBe('a:\n    b: 1\n')
  })

  it('sorts keys at every depth when asked, keeping array order', () => {
    expect(ok('{"b":1,"a":{"d":[3,1],"c":2}}', 'json', 'json', { sortKeys: true }).output)
      .toBe('{\n  "a": {\n    "c": 2,\n    "d": [\n      3,\n      1\n    ]\n  },\n  "b": 1\n}\n')
  })

  it('treats __proto__ as an ordinary key', () => {
    const result = ok('{"__proto__": {"x": 1}}', 'json', 'yaml')
    expect(result.output).toBe('__proto__:\n  x: 1\n')
    expect(({} as Record<string, unknown>).x).toBeUndefined()
  })
})

describe('TOML limits', () => {
  it('drops null-valued keys and lists them', () => {
    const result = ok('{"a": 1, "b": null, "c": {"d": null}}', 'json', 'toml')
    expect(result.output).toBe('a = 1\n\n[c]\n')
    const note = result.notes.find((item) => item.text.startsWith('TOML has no null'))!
    expect(note.level).toBe('warn')
    expect(note.items).toEqual(['.b', '.c.d'])
  })

  it('refuses null inside an array', () => {
    const result = run('{"a": [1, null]}', 'json', 'toml')
    expect(result.error).toMatchObject({ side: 'output' })
    expect(result.error!.message).toContain('.a[1]')
  })

  it('refuses an array or scalar at the root', () => {
    expect(run('[1, 2]', 'json', 'toml').error!.message).toMatch(/table .* top level.*an array/)
    expect(run('"x"', 'json', 'toml').error!.message).toMatch(/a string/)
    expect(run('- a\n- b\n', 'yaml', 'toml').error!.message).toMatch(/an array/)
  })

  it('refuses integers outside 64 bits', () => {
    expect(run('{"a": 99999999999999999999}', 'json', 'toml').error!.message).toMatch(/64-bit/)
  })

  it('turns dates and times into strings for JSON and YAML, and says so', () => {
    const toml = 'odt = 1979-05-27T07:32:00Z\nldt = 1979-05-27T07:32:00\nld = 1979-05-27\nlt = 07:32:00\n'
    const json = ok(toml, 'toml', 'json')
    expect(JSON.parse(json.output)).toEqual({ odt: '1979-05-27T07:32:00Z', ldt: '1979-05-27T07:32:00', ld: '1979-05-27', lt: '07:32:00' })
    expect(json.notes.find((note) => note.text.startsWith('TOML dates'))!.items).toEqual(['.odt', '.ldt', '.ld', '.lt'])
    expect(noteText(ok(toml, 'toml', 'yaml'))).toMatch(/TOML dates and times became plain strings/)
    // Staying in TOML keeps them dates.
    expect(ok(toml, 'toml', 'toml').notes).toEqual([])
  })

  it('keeps TOML time fractions finer than a millisecond', () => {
    const toml = 'odt = 1979-05-27T00:32:00.999999-07:00\nexact = 1979-05-27T00:32:00.5\nzeros = 07:32:00.123000\n'
      + 'note = "1979-05-27T00:32:00.999999Z is only text"\n[t]\nlt = 07:32:00.1234 # c 00:00:00.12345\nlist = [1979-05-27 00:32:00.0000001Z]\n'
    const expected = {
      odt: '1979-05-27T00:32:00.999999-07:00', exact: '1979-05-27T00:32:00.500', zeros: '07:32:00.123000',
      note: '1979-05-27T00:32:00.999999Z is only text', t: { lt: '07:32:00.1234', list: ['1979-05-27T00:32:00.0000001Z'] },
    }
    expect(JSON.parse(ok(toml, 'toml', 'json').output)).toEqual(expected)
    expect(parseYamlLib(ok(toml, 'toml', 'yaml').output)).toEqual(expected)
    const back = ok(toml, 'toml', 'toml')
    expect(back.notes.map((note) => note.text)).toEqual(['Comments are not carried over.'])
    expect(back.output).toMatch(/odt = 1979-05-27T00:32:00\.999999-07:00/)
    expect(back.output).toMatch(/lt = 07:32:00\.1234\b/)
    expect(back.output).toMatch(/1979-05-27T00:32:00\.0000001Z/)
  })

  it('says TOML comments are not carried over', () => {
    expect(noteText(ok('# top\na = 1 # trailing\n', 'toml', 'json'))).toMatch(/Comments/)
    expect(noteText(ok('a = "# not a comment"\nb = \'#\'\nc = """\n# still a string\n"""\n', 'toml', 'json'))).not.toMatch(/Comments/)
  })

  it('finds a # only outside TOML strings', () => {
    expect(tomlHasComment('a = "x \\" # y"')).toBe(false)
    expect(tomlHasComment('a = "x" # y')).toBe(true)
    expect(tomlHasComment("a = '''\n#\n'''\nb = 1")).toBe(false)
  })
})

describe('big integers', () => {
  const big = '9007199254740993'
  it('stays exact from JSON, YAML and TOML', () => {
    expect(ok(`{"big": ${big}, "n": "y"}`, 'json', 'yaml').output).toBe(`big: ${big}\n"n": "y"\n`)
    expect(ok(`n: ${big}\n`, 'yaml', 'toml').output).toBe(`n = ${big}\n`)
    expect(ok(`n = ${big}\n`, 'toml', 'json').output).toContain(`"n": ${big}`)
  })

  it('warns when JSON output carries integers JSON.parse would round', () => {
    const result = ok(`n = ${big}\nsmall = 3\n`, 'toml', 'json')
    const note = result.notes.find((item) => item.text.startsWith('Integers beyond'))!
    expect(note.level).toBe('warn')
    expect(note.items).toEqual(['.n'])
    expect(ok('n: 9007199254740991\n', 'yaml', 'json').notes).toEqual([])
  })
})

describe('YAML specifics', () => {
  it('hints about the Norway problem and keeps `no` a string', () => {
    const result = ok('country: no\nquoted: "no"\non: push\n', 'yaml', 'json')
    expect(JSON.parse(result.output)).toEqual({ country: 'no', quoted: 'no', on: 'push' })
    const note = result.notes.find((item) => item.text.includes('Norway'))!
    expect(note.level).toBe('info')
    expect(note.items).toEqual(['line 1: no', 'line 3: on'])
  })

  it('quotes YAML 1.1 booleans it writes', () => {
    expect(ok('{"country": "no", "yes": "on"}', 'json', 'yaml').output).toBe('country: "no"\n"yes": "on"\n')
  })

  it('quotes a << key so the YAML reads back as the same data', () => {
    for (const json of ['{"<<": {"a": 1}, "b": 2}', '{"<<": "x"}', '{"m": {"<<": [{"a": 1}]}}']) {
      const yaml = ok(json, 'json', 'yaml').output
      expect(yaml).toMatch(/"<<":/)
      expect(JSON.parse(ok(yaml, 'yaml', 'json').output)).toEqual(JSON.parse(json))
    }
  })

  it('quotes strings YAML 1.1 reads as numbers or dates', () => {
    const json = '{"a": "1_000", "b": "2001-12-14", "c": "2001-12-14 21:59:43.10 -5", "d": "0b101", "e": "1_0.5", "f": "+12_3", "g": "1.2.3", "h": "v1"}'
    const yaml = ok(json, 'json', 'yaml').output
    expect(yaml).toBe('a: "1_000"\nb: "2001-12-14"\nc: "2001-12-14 21:59:43.10 -5"\nd: "0b101"\ne: "1_0.5"\nf: "+12_3"\ng: 1.2.3\nh: v1\n')
    expect(JSON.parse(ok(yaml, 'yaml', 'json').output)).toEqual(JSON.parse(json))
  })

  it('hints about 1.1 octal and base-60 readings', () => {
    const text = noteText(ok('mode: 0755\ntime: 1:20\n', 'yaml', 'json'))
    expect(text).toMatch(/octal.*line 1: 0755/s)
    expect(text).toMatch(/base-60.*line 2: 1:20/s)
  })

  it('expands anchors and says so', () => {
    const result = ok('base: &b {x: 1}\nuse: *b\n', 'yaml', 'json')
    expect(JSON.parse(result.output)).toEqual({ base: { x: 1 }, use: { x: 1 } })
    expect(result.notes.find((note) => note.text.startsWith('Anchors'))!.items).toEqual(['line 1: &b', 'line 2: *b'])
  })

  it('expands merge keys', () => {
    const result = ok('base: &b {x: 1}\nm:\n  <<: *b\n  y: 2\n', 'yaml', 'json')
    expect(JSON.parse(result.output).m).toEqual({ x: 1, y: 2 })
    expect(noteText(result)).toMatch(/Merge keys/)
  })

  it('says comments and tags are not preserved', () => {
    const result = ok('# header\na: 1 # trailing\nbin: !!binary aGk=\nc: !custom v\n', 'yaml', 'json')
    expect(JSON.parse(result.output)).toEqual({ a: 1, bin: 'aGk=', c: 'v' })
    expect(noteText(result)).toMatch(/Comments are not carried over/)
    expect(result.notes.find((note) => note.text.startsWith('Tags'))!.items).toEqual(['line 3: !!binary', 'line 4: !custom'])
  })

  it('stringifies non-string keys with a warning', () => {
    const result = ok('1: one\ntrue: yes\n', 'yaml', 'json')
    expect(JSON.parse(result.output)).toEqual({ 1: 'one', true: 'yes' })
    expect(noteText(result)).toMatch(/Non-string keys/)
  })

  it('reports a recursive alias instead of looping', () => {
    expect(run('a: &a [*a]\n', 'yaml', 'json').error!.message).toMatch(/Recursive alias/)
  })

  it('refuses multiple documents with the library message', () => {
    expect(run('a: 1\n---\nb: 2\n', 'yaml', 'json').error).toMatchObject({ line: 2, column: 1 })
  })

  it('writes NaN and infinity as null in JSON with a warning, and keeps them in TOML', () => {
    const result = ok('a: .nan\nb: -.inf\n', 'yaml', 'json')
    expect(JSON.parse(result.output)).toEqual({ a: null, b: null })
    expect(result.notes[0].items).toEqual(['.a', '.b'])
    expect(ok('a: .nan\nb: -.inf\n', 'yaml', 'toml').output).toBe('a = nan\nb = -inf\n')
  })
})

describe('errors carry line and column', () => {
  it('JSON', () => {
    expect(run('{\n  "a": 1,\n  "b": tru\n}', 'json', 'yaml').error).toMatchObject({ line: 3, column: 8, side: 'input' })
    expect(run('{"a": 1,}', 'json', 'yaml').error).toMatchObject({ message: 'Trailing comma before }', line: 1, column: 9 })
    expect(run('{"a": "x\n"}', 'json', 'yaml').error!.message).toMatch(/Unterminated string/)
    expect(run('[01]', 'json', 'yaml').error!.message).toMatch(/leading zeros/)
    expect(run('// hi\n{}', 'json', 'yaml').error).toMatchObject({ message: 'Comments are not allowed in JSON', line: 1, column: 1 })
  })

  it('YAML', () => {
    const error = run('a: [1, 2\nb: 3', 'yaml', 'json').error!
    expect(error).toMatchObject({ line: 2, column: 1 })
    expect(error.message).not.toMatch(/at line/)
  })

  it('TOML', () => {
    expect(run('a = 1\nb = \n', 'toml', 'json').error).toMatchObject({ line: 2, column: 5, side: 'input' })
  })

  it('duplicate keys in every format', () => {
    expect(run('{"a": 1,\n "a": 2}', 'json', 'yaml').error).toMatchObject({ message: 'Duplicate key "a"', line: 2, column: 2 })
    expect(run('a: 1\na: 2\n', 'yaml', 'json').error).toMatchObject({ message: 'Map keys must be unique', line: 2, column: 1 })
    expect(run('a = 1\na = 2\n', 'toml', 'json').error).toMatchObject({ line: 2, column: 1 })
  })
})

describe('JSON parser', () => {
  it('reads what JSON.parse reads', () => {
    const text = '{"s":"\\u00e9\\n\\"\\/","e":1e3,"f":-0.5,"t":true,"z":null,"a":[],"o":{}}'
    expect(JSON.parse(JSON.stringify(parseJson(text), (_k, v) => typeof v === 'bigint' ? Number(v) : v))).toEqual(JSON.parse(text))
  })
  it('keeps integers as bigint and floats as numbers', () => {
    expect(parseJson('[1, 1.0, 1e2]')).toEqual([1n, 1, 100])
  })
})

describe('auto-detect', () => {
  it.each([
    ['{"a": 1}', 'json'],
    ['[1, 2]', 'json'],
    ['a = 1\n[t]\nb = "x"\n', 'toml'],
    ['[server]\nport = 80\n', 'toml'],
    ['a: 1\nb: [x, y]\n', 'yaml'],
    ['- one\n- two\n', 'yaml'],
  ] as const)('%j is %s', (text, format) => {
    expect(detectFormat(text).format).toBe(format)
    const result = run(text, 'auto', 'json')
    expect(result).toMatchObject({ format, guessed: false })
  })

  it('guesses from the shape when nothing parses, and shows that format\'s error', () => {
    expect(run('{"a": 1,,}', 'auto', 'yaml')).toMatchObject({ format: 'json', guessed: true, error: { side: 'input', line: 1 } })
    expect(run('[t]\na = \n', 'auto', 'json')).toMatchObject({ format: 'toml', guessed: true, error: { line: 2 } })
    expect(run('a: [1\nb: 2', 'auto', 'json')).toMatchObject({ format: 'yaml', guessed: true })
  })

  it('says when JSON-looking input only parsed as YAML', () => {
    const result = ok('{"a": [1, 2,]}', 'auto', 'json')
    expect(result.format).toBe('yaml')
    expect(noteText(result)).toMatch(/Not valid JSON \(Trailing comma before \] at line 1, column 13\)/)
  })

  it('returns nothing for blank input', () => {
    expect(run('  \n', 'auto', 'json')).toMatchObject({ output: '', notes: [] })
  })
})

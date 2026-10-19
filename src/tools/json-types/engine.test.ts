import { afterEach, describe, expect, it } from 'vitest'
import { runInference, type InferOptions, type InferResult } from './engine'
import { defaults } from './testkit'
import { MAX_DEPTH } from './infer'
import { singular, typeName } from './naming'
import { setSourceTextSupport, splitDocuments } from './parse'

function run(text: string, options: Partial<InferOptions> = {}) {
  const result = runInference(text, { ...defaults, ...options, ts: { ...defaults.ts, ...options.ts } })
  if (!result.ok) throw new Error(`expected success: ${JSON.stringify(result)}`)
  return result
}

const ts = (text: string, options: Partial<InferOptions> = {}) => run(text, options).code

afterEach(() => setSourceTextSupport(undefined))

describe('documents', () => {
  it('splits JSON Lines, pretty-printed documents and scalars', () => {
    const docs = splitDocuments('{"a":1}\n{"a":"}"}\n  [1,\n 2]\n"x" 3 true')
    expect(docs.map((doc) => doc.text)).toEqual(['{"a":1}', '{"a":"}"}', '[1,\n 2]', '"x"', '3', 'true'])
    expect(docs.map((doc) => doc.line)).toEqual([1, 2, 3, 5, 5, 5])
  })

  it('reports the layout and sample count', () => {
    expect(run('{"a":1}\n{"a":2}').stats).toMatchObject({ samples: 2, layout: 'jsonl' })
    expect(run('{\n "a": 1\n}\n{\n "a": 2\n}').stats).toMatchObject({ samples: 2, layout: 'documents' })
    expect(run('[{"a":1},{"a":2}]').stats).toMatchObject({ samples: 1, layout: 'json' })
    expect(run('[{"a":1},{"a":2}]', { arrayAsSamples: true }).stats).toMatchObject({ samples: 2 })
  })

  it('gives parse errors a sample number and a line in the whole input', () => {
    const result = runInference('{"a":1}\n{"a":2}\n{"a":}', defaults) as Extract<InferResult, { error: unknown }>
    expect(result.ok).toBe(false)
    expect(result.error.sample).toBe(3)
    expect(result.error.line).toBe(3)
    const comma = runInference('{"a":1},{"a":2}', defaults) as Extract<InferResult, { error: unknown }>
    expect(comma.error.message).toMatch(/comma between documents/)
  })

  it('treats blank input as empty, not an error', () => {
    expect(runInference('  \n', defaults)).toEqual({ ok: false, empty: true })
  })
})

describe('inference', () => {
  it('merges samples: missing keys are optional, null is nullable, mixed types are unions', () => {
    const code = ts('{"id":1,"name":"a","tag":null,"v":1}\n{"id":2,"tag":"x","v":"one"}')
    expect(code).toBe(`export interface Root {
  id: number;
  name?: string;
  tag: string | null;
  v: string | number;
}
`)
  })

  it('merges array elements into one item type, named in the singular', () => {
    const code = ts('{"categories":[{"id":1},{"id":2,"label":"x"}],"addresses":[{"zip":"1"}],"data":[{"k":true}]}')
    expect(code).toContain('categories: Category[];')
    expect(code).toContain('export interface Category {\n  id: number;\n  label?: string;\n}')
    expect(code).toContain('addresses: Address[];')
    expect(code).toContain('data: DataItem[];')
  })

  it('names a top-level array and its items', () => {
    expect(ts('[{"a":1}]')).toBe('export type Root = RootItem[];\n\nexport interface RootItem {\n  a: number;\n}\n')
  })

  it('de-duplicates names: an identical shape shares one, a different one is qualified', () => {
    const code = ts('{"billing":{"address":{"city":"x"}},"shipping":{"address":{"city":"y"}},"office":{"address":{"lat":1}}}')
    expect(code.match(/export interface Address \{/g)).toHaveLength(1)
    expect(code).toContain('export interface OfficeAddress {\n  lat: number;\n}')
    expect(code).toContain('  address: OfficeAddress;')
  })

  it('quotes keys that are not identifiers', () => {
    const code = ts('{"content-type":"x","2fa":true,"ok_1":1,"":0,"__proto__":{"a":1}}')
    expect(code).toContain('"content-type": string;')
    expect(code).toContain('"2fa": boolean;')
    expect(code).toContain('ok_1: number;')
    expect(code).toContain('"": number;')
    expect(code).toContain('__proto__: Proto;')
  })

  it('caps the depth and says where', () => {
    let deep = '1'
    for (let i = 0; i < MAX_DEPTH + 10; i++) deep = `{"n":${deep}}`
    const result = run(deep)
    expect(result.code).toContain('n: unknown;')
    expect(result.notes[0].text).toMatch(new RegExp(`deeper than ${MAX_DEPTH}`))
    expect(result.notes[0].paths?.[0]).toBe(`$${'.n'.repeat(MAX_DEPTH)}`)
  })

  it('survives nesting far past what a recursive walk could', () => {
    const text = '['.repeat(100_000) + ']'.repeat(100_000)
    const result = run(text)
    expect(result.notes[0].text).toMatch(/deeper than/)
  })

  it('types empty arrays as unknown[] and null-only fields as null, and says so', () => {
    const result = run('{"tags":[],"gone":null}')
    expect(result.code).toContain('tags: unknown[];')
    expect(result.code).toContain('gone: null;')
    expect(result.notes.map((note) => note.text).join('\n')).toMatch(/Only empty arrays[\s\S]*Only ever null|Only ever null[\s\S]*Only empty arrays/)
  })

  it('empty objects become Record<string, never>', () => {
    expect(ts('{"meta":{}}')).toContain('export type Meta = Record<string, never>;')
  })
})

describe('numbers', () => {
  it('detects integers past 2^53 from the source text and reports them', () => {
    const result = run('{"id":9007199254740993,"small":9007199254740991,"f":1.0,"e":1e3}', { target: 'jsonschema' })
    const schema = JSON.parse(result.code)
    expect(schema.properties.id).toEqual({ type: 'integer', $comment: 'integers past 2^53 seen' })
    expect(schema.properties.small).toEqual({ type: 'integer' })
    expect(schema.properties.f).toEqual({ type: 'number' })
    expect(schema.properties.e).toEqual({ type: 'number' })
    expect(result.notes.find((note) => note.text.startsWith('Integers past 2^53'))?.paths).toEqual(['$.id'])
  })

  it('without source text access, still flags unsafe integers and says the reading is approximate', () => {
    setSourceTextSupport(false)
    const result = run('{"id":9007199254740993,"f":1.0}', { target: 'jsonschema' })
    const schema = JSON.parse(result.code)
    expect(schema.properties.f).toEqual({ type: 'integer' })
    expect(result.notes[0].text).toMatch(/can’t show JSON.parse the source text/)
  })

  it('a mix of integers and floats is a number', () => {
    expect(JSON.parse(run('[1, 2.5]', { target: 'jsonschema' }).code).items).toEqual({ type: 'number' })
  })
})

describe('formats and enums are opt-in and always listed', () => {
  const sample = JSON.stringify([
    { at: '2024-05-01T10:00:00Z', day: '2024-05-01', id: '0b9e7c1e-6a43-4f7e-9d0a-2c6f2a1b3c4d', mail: 'a@example.com', url: 'https://example.com/a', status: 'open' },
    { at: '2024-05-02T10:00:00.123+05:30', day: '2024-02-29', id: '3f0c1d2e-9b8a-4c7d-8e6f-5a4b3c2d1e0f', mail: 'b.c@example.org', url: 'http://example.org', status: 'closed' },
    { at: '2024-05-03T10:00:00Z', day: '2024-05-03', id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', mail: 'd+e@example.net', url: 'https://example.net/?q=1', status: 'open' },
    { at: '2024-05-04T10:00:00Z', day: '2024-05-04', id: 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', mail: 'f@example.com', url: 'https://example.com/b', status: 'closed' },
  ])

  it('off: plain strings, with a note naming the matches', () => {
    const result = run(sample)
    expect(result.code).toContain('at: string;')
    expect(result.code).toContain('status: string;')
    const text = result.notes.map((note) => [note.text, ...(note.paths ?? [])].join('\n')).join('\n')
    expect(text).toContain('Turn on Formats')
    expect(text).toContain('$[].at — date-time')
    expect(text).toContain('$[].day — date')
    expect(text).toContain('$[].id — uuid')
    expect(text).toContain('$[].mail — email')
    expect(text).toContain('$[].url — uri')
    expect(text).toContain('Turn on Enums')
    expect(text).toContain('$[].status — "open", "closed"')
  })

  it('on: refined in every target', () => {
    const options = { formats: true, enums: true }
    expect(ts(sample, options)).toContain('status: "open" | "closed";')
    expect(ts(sample, options)).toContain('/** format: date-time */\n  at: string;')
    const zod = ts(sample, { ...options, target: 'zod' })
    expect(zod).toContain('at: z.iso.datetime({ offset: true }),')
    expect(zod).toContain('day: z.iso.date(),')
    expect(zod).toContain('id: z.uuid(),')
    expect(zod).toContain('mail: z.email(),')
    expect(zod).toContain('url: z.url(),')
    expect(zod).toContain('status: z.enum(["open", "closed"]),')
    const schema = JSON.parse(ts(sample, { ...options, target: 'jsonschema' }))
    expect(schema.$defs.RootItem.properties.at).toEqual({ type: 'string', format: 'date-time' })
    expect(schema.$defs.RootItem.properties.status).toEqual({ enum: ['open', 'closed'] })
    expect(ts(sample, { ...options, target: 'go' })).toMatch(/At\s+time\.Time\s+`json:"at"`/)
    expect(ts(sample, { ...options, target: 'python', python: 'pydantic' })).toContain('at: dt.datetime')
    expect(ts(sample, { ...options, target: 'python', python: 'typeddict' })).toContain('at: str  # format: date-time')
  })

  it('one value that does not match drops the format', () => {
    const result = run('["2024-05-01T10:00:00Z","2024-13-01T10:00:00Z"]', { formats: true })
    expect(result.code).toBe('export type Root = string[];\n')
    expect(run('["2023-02-29"]', { formats: true }).code).toBe('export type Root = string[];\n')
    expect(run('["not-a-uuid-0000-0000-000000000000"]', { formats: true }).code).toBe('export type Root = string[];\n')
    expect(run('["mailto:a@example.com"]', { formats: true }).code).toBe('export type Root = string[];\n')
    expect(run('["https://exa mple.com"]', { formats: true }).code).toBe('export type Root = string[];\n')
  })

  it('distinct values must repeat to count as an enum', () => {
    expect(run('[{"n":"a"},{"n":"b"},{"n":"c"}]', { enums: true }).code).toContain('n: string;')
    expect(run('[{"n":"a"},{"n":"b"},{"n":"a"},{"n":"b"}]', { enums: true }).code).toContain('n: "a" | "b";')
    expect(run('["a","b","c","a","b","c"]', { enums: true, enumMax: 2 }).code).toBe('export type Root = string[];\n')
  })
})

describe('TypeScript options', () => {
  const sample = '{"a":1,"list":[[{"x":1}]]}\n{"list":[]}'

  it('type aliases, readonly, and the optional styles', () => {
    expect(ts(sample, { ts: { declaration: 'type', optional: 'question', readonly: true } })).toBe(`export type Root = {
  readonly a?: number;
  readonly list: readonly (readonly ListItem[])[];
};

export type ListItem = {
  readonly x: number;
};
`)
    expect(ts(sample, { ts: { declaration: 'interface', optional: 'question-undefined', readonly: false } })).toContain('a?: number | undefined;')
    expect(ts(sample, { ts: { declaration: 'interface', optional: 'undefined', readonly: false } })).toContain('  a: number | undefined;')
  })

  it('root name is made an identifier', () => {
    expect(ts('{"a":1}', { rootName: 'api response' })).toContain('export interface ApiResponse {')
    expect(ts('{"a":1}', { rootName: '123' })).toContain('export interface Root {')
    expect(ts('{"a":1}', { rootName: 'Date' })).toContain('export interface DateType {')
  })
})

describe('naming', () => {
  it('singularises the last word', () => {
    expect(['Users', 'Categories', 'Boxes', 'Addresses', 'Statuses', 'People', 'Data', 'Root', 'Matches', 'Keys', 'Series'].map(singular))
      .toEqual(['User', 'Category', 'Box', 'Address', 'Status', 'Person', 'DataItem', 'RootItem', 'Match', 'Key', 'SeriesItem'])
    expect(singular('LineItems')).toBe('LineItem')
  })

  it('makes PascalCase names from keys, with fallbacks', () => {
    expect(typeName('user_profile', 'Root')).toBe('UserProfile')
    expect(typeName('userProfile', 'Root')).toBe('UserProfile')
    expect(typeName('2fa', 'Root')).toBe('Root2fa')
    expect(typeName('名前', 'Root')).toBe('Root')
    expect(typeName('date', 'Root')).toBe('DateType')
  })
})

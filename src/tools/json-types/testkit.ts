/** Test helpers: default options and a corpus of inputs for the compile tests. Not imported by the tool. */

import type { InferOptions } from './engine'

export const defaults: InferOptions = {
  rootName: 'Root',
  formats: false,
  enums: false,
  enumMax: 8,
  arrayAsSamples: false,
  target: 'typescript',
  ts: { declaration: 'interface', optional: 'question', readonly: false },
  python: 'typeddict',
}

let deep = '"bottom"'
for (let i = 0; i < 70; i++) deep = `{"next":${deep},"level":${i}}`

export interface Case {
  name: string
  text: string
  options?: Partial<InferOptions>
}

/** Every case must produce code that compiles and accepts every one of its samples. */
export const corpus: Case[] = [
  {
    name: 'api',
    text: JSON.stringify({
      id: 1,
      user_name: 'ada',
      'e-mail': 'ada@example.com',
      created: '2024-05-01T10:00:00Z',
      day: '2024-01-01',
      homepage: 'https://example.com/ada',
      orders: [
        { order_id: '0b9e7c1e-6a43-4f7e-9d0a-2c6f2a1b3c4d', total: 10.5, status: 'open', items: [{ sku: 'a', qty: 1 }] },
        { order_id: '3f0c1d2e-9b8a-4c7d-8e6f-5a4b3c2d1e0f', total: 3, status: 'open', note: null, items: [] },
        { order_id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', total: 7.25, status: 'shipped', note: 'leave at door', items: [{ sku: 'b', qty: 2, gift: true }] },
        { order_id: 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', total: 1, status: 'shipped', items: [] },
      ],
      meta: {},
      tags: [],
      mixed: [1, 'a', null, { k: 1 }, [true]],
    }),
    options: { formats: true, enums: true },
  },
  { name: 'api-plain', text: '{"id":1,"orders":[{"status":"open","total":1.5},{"status":"open"}],"when":"2024-05-01T10:00:00Z"}' },
  {
    name: 'jsonl',
    text: '{"id":1,"name":"a","tag":null,"v":1}\n{"id":2,"tag":"x","v":"one","extra":{"deep":[1,2.5]}}\n{"id":3,"v":false,"extra":null}',
  },
  { name: 'records', text: '[{"a":1,"b":"x"},{"a":2},{"a":3,"c":[{"d":null},{"d":4}]}]' },
  { name: 'records-as-samples', text: '[{"a":1,"b":"x"},{"a":2},{"a":3,"c":[{"d":null},{"d":4}]}]', options: { arrayAsSamples: true } },
  { name: 'scalars', text: '"x"\n1\nnull\n2.5' },
  { name: 'nested-arrays', text: '{"grid":[[[1,2],[3]],[[]]],"rows":[[{"x":1}],[{"x":2,"y":"b"}]]}' },
  { name: 'deep', text: deep },
  { name: 'empties', text: '{"meta":{},"list":[],"nothing":null,"rows":[{}]}' },
  {
    name: 'collisions',
    text: '{"billing":{"address":{"city":"x"}},"shipping":{"address":{"city":"y"}},"office":{"address":{"lat":1}},"root":{"a":1},"date":{"y":2024},"list":{"n":1}}',
  },
  {
    name: 'odd-keys',
    text: JSON.stringify({
      'content-type': 'json',
      '2fa': true,
      from: 'x',
      class: 1,
      list: [1],
      str: 'shadow',
      json: 'pydantic attribute',
      model_name: 'm',
      _private: 1,
      __dunder: 2,
      名前: 'unicode',
      'with space': 1,
      $dollar: 1,
      '': 'empty key',
      userId: 1,
      user_id: 2,
      date: '2024-01-01',
    }),
    options: { formats: true },
  },
  { name: 'big', text: '{"id":9007199254740993,"ids":[1,12345678901234567890],"ratio":1.0,"sci":1e3}\n{"id":2}' },
  { name: 'enums', text: '[{"s":"a","n":1},{"s":"b","n":"x"},{"s":"a","n":null},{"s":"b"}]', options: { enums: true } },
]

/** The JSON values of a case, as each target should accept them. */
export function samplesOf(c: Case): string[] {
  const docs: string[] = []
  // Plain splitting is enough for the corpus: one document per line, or one document.
  for (const line of c.text.includes('\n') ? c.text.split('\n') : [c.text]) {
    if (!line.trim()) continue
    if (c.options?.arrayAsSamples) {
      const value = JSON.parse(line)
      if (Array.isArray(value)) {
        docs.push(...value.map((item) => JSON.stringify(item)))
        continue
      }
    }
    docs.push(line)
  }
  return docs
}

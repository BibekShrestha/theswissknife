import { describe, expect, it } from 'vitest'
import { formatJson } from './jsonFormat'

const ok = (text: string, indent: number) => {
  const result = formatJson(text, indent)
  if ('error' in result) throw new Error(result.error)
  return result.text
}

describe('JQ-3: Format / Minify keep the data exactly', () => {
  it('keeps number literals as written', () => {
    expect(ok('{"big": 12345678901234567890, "huge": 1E400, "price": 1.10, "n": -0}', 0)).toBe(
      '{"big":12345678901234567890,"huge":1E400,"price":1.10,"n":-0}',
    )
  })

  it('keeps duplicate keys and string escapes', () => {
    expect(ok('{"a": 1, "a": 2, "s": "\\u00e9\\n"}', 0)).toBe('{"a":1,"a":2,"s":"\\u00e9\\n"}')
  })

  it('pretty-prints like JSON.stringify for ordinary data', () => {
    const value = { a: [1, 2, { b: null }], c: {}, d: [], e: 'x y', f: true }
    const text = JSON.stringify(value)
    expect(ok(text, 2)).toBe(JSON.stringify(value, null, 2))
    expect(ok(JSON.stringify(value, null, 2), 0)).toBe(text)
  })

  it('formats every document of a multi-document input', () => {
    expect(ok('{"a":1} [2]\n3', 2)).toBe('{\n  "a": 1\n}\n[\n  2\n]\n3')
  })

  it('refuses what is not JSON, saying where', () => {
    expect(formatJson('{"a": 1,}', 2)).toMatchObject({ error: expect.stringMatching(/column 9/) })
    expect(formatJson('{"a": 01}', 2)).toHaveProperty('error')
    expect(formatJson('"tab\there"', 2)).toHaveProperty('error')
    expect(formatJson('[1, 2', 2)).toHaveProperty('error')
    expect(formatJson('', 2)).toHaveProperty('error')
    expect(formatJson('NaN', 2)).toHaveProperty('error')
  })
})

import { describe, expect, it } from 'vitest'
import { canonicalJson, computeDiff, type DiffOptions } from './compute'

const json: DiffOptions = { mode: 'json', ignoreWhitespace: false, ignoreCase: false }

// JSON.parse source text access (the reviver's context.source) is what lets
// a literal keep digits a double cannot hold. Skip where the engine lacks it.
const sourceAccess = JSON.parse('1', (_k, v, ctx?: { source?: string }) => ctx?.source ?? v) === '1'

const differs = (left: string, right: string) => {
  const result = computeDiff(left, right, json)
  if ('error' in result) throw new Error(result.error)
  return result.added + result.removed > 0
}

describe.runIf(sourceAccess)('JSON numbers compare by the literal’s value, not its double (DIF-3)', () => {
  it.each([
    ['{"a":1e400}', '{"a":null}'],
    ['{"a":-1e400}', '{"a":null}'],
    ['{"a":1e400}', '{"a":-1e400}'],
    ['[9007199254740993.0]', '[9007199254740992]'],
    ['[0.1]', '[0.10000000000000000555]'],
    ['[1e-400]', '[0]'],
  ])('%s differs from %s', (left, right) => {
    expect(differs(left, right)).toBe(true)
  })

  it.each([
    ['[1.0]', '[1]'],
    ['[0.10]', '[0.1]'],
    ['[1E2]', '[100]'],
    ['[1e400]', '[10e399]'],
    ['[9007199254740993]', '[9007199254740993.000]'],
    ['[-0]', '[0]'],
  ])('%s and %s are the same number', (left, right) => {
    expect(differs(left, right)).toBe(false)
  })

  it('prints a literal a double cannot hold in a normalised form', () => {
    expect(canonicalJson('{"big":1e400,"x":0.10000000000000000555,"n":12.50}', 'x')).toEqual({
      text: '{\n  "big": 1e+400,\n  "n": 12.5,\n  "x": 0.10000000000000000555\n}\n',
      duplicates: false,
    })
  })
})

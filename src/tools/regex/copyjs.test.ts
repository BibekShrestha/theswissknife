import { describe, expect, it } from 'vitest'
import { literalSource, toConstructor, toLiteral, toReplaceCall } from './copyjs'

/** Evaluates the snippet as JavaScript source, the way a user's code would. */
const evaluate = (code: string): RegExp => new Function(`return ${code}`)() as RegExp

const CASES: [string, string][] = [
  ['', ''],
  ['a/b', 'g'],
  ['[/]', ''],
  ['[\\/]', 'v'],
  ['[/]+', 'u'],
  ['\\/', 'u'],
  ['\\\\/', ''],
  ['line\nbreak', 'g'],
  ['cr\rlf', ''],
  ['\u2028\u2029', 'u'],
  ['\\\n', ''],
  ['(?<word>\\p{Lu}\\p{Ll}+)', 'gu'],
  ['"quotes" and \'apostrophes\' `ticks` ${x}', ''],
  ['</script>', 'i'],
  ['😀|\\u{1F600}', 'u'],
  ['[\\p{L}--[a-z]]', 'v'],
  ['a*/', 'y'],
]

describe('copy as JS', () => {
  it.each(CASES)('literal for %j /%s builds the same RegExp', (pattern, flags) => {
    const expected = new RegExp(pattern, flags)
    const literal = evaluate(toLiteral(pattern, flags))
    expect(literal.source).toBe(expected.source)
    expect(literal.flags).toBe(expected.flags)
    for (const sample of ['a/b', 'line\nbreak', '\\', 'Hello World', '😀', '\u2028\u2029', '[/]']) {
      expect(sample.match(literal)?.[0]).toBe(sample.match(expected)?.[0])
    }
  })

  it.each(CASES)('constructor for %j /%s builds the same RegExp', (pattern, flags) => {
    const built = evaluate(toConstructor(pattern, flags))
    expect(built.source).toBe(new RegExp(pattern, flags).source)
    expect(built.flags).toBe(new RegExp(pattern, flags).flags)
  })

  it('writes the empty pattern so it is not a comment', () => {
    expect(toLiteral('', 'g')).toBe('/(?:)/g')
  })

  it('keeps every line terminator out of the literal', () => {
    expect(literalSource('a\nb\rc\u2028d\u2029e')).toBe('a\\nb\\rc\\u2028d\\u2029e')
    expect(toLiteral('x/y', '')).toBe('/x\\/y/')
  })

  it('omits empty flags from the constructor', () => {
    expect(toConstructor('a"b', '')).toBe('new RegExp("a\\"b")')
  })

  it('builds a replace call that runs', () => {
    const call = toReplaceCall('(\\w+)@(\\w+)', 'g', '$2 at $1 "quoted"')
    const result = new Function('text', `return ${call}`)('me@home')
    expect(result).toBe('home at me "quoted"')
  })
})

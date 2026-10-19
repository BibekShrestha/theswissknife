import { describe, expect, it } from 'vitest'
import { parseBase64, parseInput } from './input'

const bytesOf = (text: string, encoding: 'auto' | 'hex' | 'base64' = 'auto') => Array.from(parseInput(text, encoding).bytes ?? [])

describe('input parsing', () => {
  it('reads hex in the usual spellings', () => {
    expect(bytesOf('08 96 01')).toEqual([8, 0x96, 1])
    expect(bytesOf('0x08, 0x96, 0x01')).toEqual([8, 0x96, 1])
    expect(bytesOf('\\x08\\x96\\x01')).toEqual([8, 0x96, 1])
    expect(bytesOf('08:96:01\n')).toEqual([8, 0x96, 1])
    expect(bytesOf('0x089601')).toEqual([8, 0x96, 1])
    expect(bytesOf('DEADbeef')).toEqual([0xde, 0xad, 0xbe, 0xef])
  })

  it('reads Base64 and Base64URL, padded or not', () => {
    expect(parseInput('CJYB', 'auto')).toMatchObject({ encoding: 'base64' })
    expect(bytesOf('CJYB')).toEqual([8, 0x96, 1])
    expect(bytesOf('+/8=')).toEqual([0xfb, 0xff])
    expect(bytesOf('-_8')).toEqual([0xfb, 0xff])
    expect(parseInput('-_8', 'auto').encoding).toBe('base64url')
    expect(bytesOf('YW Jj\nZA==')).toEqual([...'abcd'].map((c) => c.charCodeAt(0)))
  })

  it('prefers hex when the text is both, and says so', () => {
    const r = parseInput('deadbeef', 'auto')
    expect(r.encoding).toBe('hex')
    expect(r.note).toMatch(/Also valid Base64/)
    expect(bytesOf('deadbeef', 'base64')).toEqual([0x75, 0xe6, 0x9d, 0x6d, 0xe7, 0x9f])
  })

  it('explains bad input', () => {
    expect(parseInput('089', 'hex').error).toMatch(/Odd number of hex digits/)
    expect(parseInput('zz', 'hex').error).toMatch(/unexpected “z”/)
    expect(parseInput('a+b_', 'base64').error).toMatch(/mixes the standard/)
    expect(parseInput('abcde', 'base64').error).toMatch(/stray character/)
    expect(parseBase64('ab=c')).toMatchObject({ error: expect.stringMatching(/unexpected “=”/) })
    expect(parseInput('hello world!', 'auto').error).toMatch(/Neither hex nor Base64/)
    expect(parseInput('   ', 'auto')).toMatchObject({ bytes: new Uint8Array(0), error: null })
  })
})

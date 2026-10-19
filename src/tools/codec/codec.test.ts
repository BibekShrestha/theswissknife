import { describe, expect, it } from 'vitest'
import { convertCodec } from './codec'

describe('codec conversions', () => {
  const unicode = 'héllo — नेपाली ✓'

  it.each(['base64', 'base64url', 'hex'] as const)('round-trips UTF-8 through %s', (codec) => {
    const encoded = convertCodec(codec, 'encode', unicode)
    expect(encoded.error).toBeNull()
    expect(convertCodec(codec, 'decode', encoded.value)).toEqual({ value: unicode, error: null })
  })

  it('keeps Base64URL unpadded and accepts whitespace in Base64', () => {
    expect(convertCodec('base64url', 'encode', 'hello?').value).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(convertCodec('base64', 'decode', 'aGVs\n bG8=')).toEqual({ value: 'hello', error: null })
  })

  it('round-trips URL components and full URIs', () => {
    const component = 'a value/with?parts=yes'
    const encoded = convertCodec('url-component', 'encode', component).value
    expect(convertCodec('url-component', 'decode', encoded).value).toBe(component)
    expect(convertCodec('url-full', 'encode', 'https://example.com/a b?q=x y').value).toBe('https://example.com/a%20b?q=x%20y')
  })

  it('encodes and decodes HTML entities', () => {
    expect(convertCodec('html', 'encode', '<p title="x">A&B</p>').value).toBe('&lt;p title=&quot;x&quot;&gt;A&amp;B&lt;/p&gt;')
    expect(convertCodec('html', 'decode', '&lt;p&gt;&#x2713;&lt;/p&gt;').value).toBe('<p>✓</p>')
  })

  it('rejects malformed and non-UTF-8 input', () => {
    expect(convertCodec('base64', 'decode', '%%%').error).toMatch(/Invalid Base64/)
    expect(convertCodec('hex', 'decode', 'abc').error).toMatch(/odd number of hex digits/)
    expect(convertCodec('hex', 'decode', 'ff').error).toMatch(/UTF-8/)
    expect(convertCodec('url-component', 'decode', '%zz').error).toMatch(/percent-escape/)
  })

  it('keeps a leading byte-order mark when decoding (COD-2)', () => {
    const bom = '\ufeffhi'
    for (const codec of ['base64', 'base64url', 'hex'] as const) {
      const encoded = convertCodec(codec, 'encode', bom).value
      expect(convertCodec(codec, 'decode', encoded).value).toBe(bom)
    }
    expect(convertCodec('hex', 'decode', 'ef bb bf 68 69').value).toBe(bom)
  })

  it('reads hex written with 0x or \\x prefixes and says what is wrong otherwise (COD-3)', () => {
    expect(convertCodec('hex', 'decode', '0x48 0x69').value).toBe('Hi')
    expect(convertCodec('hex', 'decode', '\\x48\\x69').value).toBe('Hi')
    expect(convertCodec('hex', 'decode', '48,69').value).toBe('Hi')
    expect(convertCodec('hex', 'decode', '4g').error).toMatch(/only hex digits.*"g"/)
    expect(convertCodec('hex', 'decode', '486').error).toMatch(/odd number of hex digits/)
  })

  it('explains a lone surrogate when URL-encoding instead of blaming a percent-escape (COD-3)', () => {
    const lone = 'a\ud83d'
    expect(convertCodec('url-component', 'encode', lone).error).toMatch(/lone surrogate/)
    expect(convertCodec('url-full', 'encode', lone).error).toMatch(/lone surrogate/)
    expect(convertCodec('url-component', 'decode', '%E0%A4%A').error).toMatch(/percent-escape/)
  })

  it('warns when a lone surrogate is encoded as U+FFFD (COD-3)', () => {
    for (const codec of ['base64', 'base64url', 'hex'] as const) {
      const result = convertCodec(codec, 'encode', 'a\ud83d')
      expect(result.error).toBeNull()
      expect(result.warning).toMatch(/1 lone surrogate.*U\+FFFD/)
    }
    expect(convertCodec('base64', 'encode', 'a😀').warning).toBeUndefined()
  })

  it('decodes HTML entities without a DOM the same way for the common cases', () => {
    expect(convertCodec('html', 'decode', '  <b>&amp;</b> &#0; &#xD800;').value).toBe('  <b>&</b> \ufffd \ufffd')
  })
})

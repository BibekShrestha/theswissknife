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
    expect(convertCodec('hex', 'decode', 'abc').error).toMatch(/byte pairs/)
    expect(convertCodec('hex', 'decode', 'ff').error).toMatch(/UTF-8/)
    expect(convertCodec('url-component', 'decode', '%zz').error).toMatch(/percent-escape/)
  })
})

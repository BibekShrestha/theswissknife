/**
 * HTML-entity decoding as it runs in the browser, where a DOM is available.
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { convertCodec } from './codec'

const decode = (input: string) => convertCodec('html', 'decode', input)

describe('HTML entity decode in a browser (COD-1)', () => {
  it('decodes entities and nothing else: tags, comments and whitespace stay', () => {
    expect(decode('  <b>x</b> &amp; <!-- note --> &lt;i&gt;\n')).toEqual({ value: '  <b>x</b> & <!-- note --> <i>\n', error: null })
  })

  it('keeps markup that would end or escape a container as plain text', () => {
    const input = '</textarea><img src=x onerror=alert(1)><script>1</script>'
    expect(decode(input).value).toBe(input)
  })

  it('knows the full named-entity list, numeric forms and legacy no-semicolon names', () => {
    expect(decode('&NotEqualTilde; &hearts; &#x2713; &#128; &copy 2026').value).toBe('≂̸ ♥ ✓ € © 2026')
  })

  it('keeps line endings and NUL exactly as they came in', () => {
    expect(decode('a\r\nb\rc\0d &amp;\r\n').value).toBe('a\r\nb\rc\0d &\r\n')
  })

  it('keeps a leading line break', () => {
    expect(decode('\n&lt;x').value).toBe('\n<x')
  })
})

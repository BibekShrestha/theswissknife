import { describe, expect, it } from 'vitest'
import { highlight, resolveLang, tokenize } from './highlight'

const classes = (code: string, lang: string) => tokenize(code, lang).filter((t) => t.cls).map((t) => `${t.cls}:${t.text}`)

describe('highlight', () => {
  it('resolves aliases and info strings', () => {
    expect(resolveLang('TypeScript')).toBe('ts')
    expect(resolveLang('js {1,3}')).toBe('js')
    expect(resolveLang('brainfuck')).toBeNull()
  })

  it('tokenizes JS with strings before keywords', () => {
    expect(classes('const s = "if" // done', 'js')).toEqual(['key:const', 'str:"if"', 'com:// done'])
  })

  it('does not see keywords inside identifiers', () => {
    expect(classes('isNaN(x)', 'ts')).toEqual([])
  })

  it('handles python, sql, yaml, shell and json', () => {
    expect(classes('def f(): return None  # c', 'py')).toEqual(['key:def', 'key:return', 'lit:None', 'com:# c'])
    expect(classes("SELECT 'a' FROM t", 'sql')).toEqual(['key:SELECT', "str:'a'", 'key:FROM'])
    expect(classes('name: x # c', 'yaml')).toEqual(['key:name', 'com:# c'])
    expect(classes('echo "$HOME"', 'sh')).toEqual(['str:"$HOME"'])
    expect(classes('{"a": 1, "b": true}', 'json')).toEqual(['str:"a"', 'num:1', 'str:"b"', 'lit:true'])
  })

  it('colours diff lines whole', () => {
    expect(classes('@@ -1 +1 @@\n-old\n+new\n same', 'diff')).toEqual(['meta:@@ -1 +1 @@\n', 'del:-old\n', 'add:+new\n'])
  })

  it('falls back to one plain token', () => {
    expect(tokenize('a < b', 'unknown')).toEqual([{ cls: null, text: 'a < b' }])
  })

  it('escapes all markup, highlighted or not', () => {
    expect(highlight('<script>"x"</script>', 'html')).not.toContain('<script>')
    expect(highlight('a<b>&c', 'nope')).toBe('a&lt;b&gt;&amp;c')
  })
})

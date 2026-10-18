import { describe, expect, it } from 'vitest'
import { generate, targets } from './generate'
import { parseCurl } from './parse'
import { findSecrets, redactInput } from './secrets'
import { detectDialect, quoteBash, quoteCmd, tokenize, type Dialect } from './tokenize'

const words = (input: string, dialect?: Dialect) => tokenize(input, dialect).tokens.map((token) => token.value)
const notes = (input: string, dialect?: Dialect) => tokenize(input, dialect).notes.map((note) => note.text).join('\n')

describe('bash words', () => {
  it('handles single, double and ANSI-C quoting', () => {
    expect(words(`curl 'a b' "c \\"d\\" \\$e \\x" f\\ g`)).toEqual(['curl', 'a b', 'c "d" $e \\x', 'f g'])
    expect(words(`curl $'it\\'s\\n\\t\\x41\\101\\u20ac\\U0001F600\\cA'`)).toEqual(['curl', "it's\n\tAA€😀\x01"])
    expect(words(`curl ab'cd'"ef"$'g'`)).toEqual(['curl', 'abcdefg'])
    expect(words(`curl '' ""`)).toEqual(['curl', '', ''])
  })

  it('joins backslash-newline continuations, inside words too', () => {
    expect(words('curl \\\n  -H \'a: b\' \\\n  https://x')).toEqual(['curl', '-H', 'a: b', 'https://x'])
    expect(words('curl ab\\\ncd')).toEqual(['curl', 'abcd'])
    expect(words('curl "ab\\\ncd"')).toEqual(['curl', 'abcd'])
  })

  it('decodes \\x byte runs as UTF-8, and as Latin-1 when they are not UTF-8', () => {
    expect(words(`curl $'\\xe2\\x82\\xac'`)).toEqual(['curl', '€'])
    const result = tokenize(`curl $'Ren\\xe9e'`)
    expect(result.tokens[1].value).toBe('Renée')
    expect(result.notes[0].level).toBe('info')
  })

  it('records source spans that cover the quotes', () => {
    const input = `curl  'a b'  "c"`
    const tokens = tokenize(input).tokens
    expect(tokens.map((t) => input.slice(t.start, t.end))).toEqual(['curl', "'a b'", '"c"'])
  })

  it('keeps variables and substitutions literal, with a warning', () => {
    const input = 'curl -H "Authorization: Bearer $TOKEN" https://x/$(whoami) `id` ${HOME}'
    expect(words(input)).toEqual(['curl', '-H', 'Authorization: Bearer $TOKEN', 'https://x/$(whoami)', '`id`', '${HOME}'])
    const text = notes(input)
    expect(text).toContain('$TOKEN is not expanded')
    expect(text).toContain('$(whoami) is not run')
    expect(text).toContain('`id` is not run')
    expect(text).toContain('${HOME} is not expanded')
  })

  it('stops at pipes, lists and unquoted &, and says what it ignored', () => {
    expect(words("curl https://x | jq '.items'")).toEqual(['curl', 'https://x'])
    expect(notes("curl https://x | jq '.items'")).toContain('“| jq \'.items\'”')
    expect(words('curl https://x?a=1&b=2')).toEqual(['curl', 'https://x?a=1'])
    expect(notes('curl https://x?a=1&b=2')).toContain('quote the URL')
    expect(words('curl https://x && echo done')).toEqual(['curl', 'https://x'])
    expect(words('curl https://x; ls')).toEqual(['curl', 'https://x'])
  })

  it('skips redirects and their targets, with a warning', () => {
    expect(words('curl https://x > out.json 2>/dev/null -s')).toEqual(['curl', 'https://x', '-s'])
    expect(notes('curl https://x > out.json')).toContain('> out.json was ignored')
    expect(words('curl https://x 2>&1')).toEqual(['curl', 'https://x'])
  })

  it('reads lines that start with - as a continuation, and warns', () => {
    expect(words("curl https://x\n  -H 'a: b'\n  -d c")).toEqual(['curl', 'https://x', '-H', 'a: b', '-d', 'c'])
    expect(notes("curl https://x\n  -H 'a: b'")).toContain('does not end with a backslash')
    expect(words('curl https://x\necho hi')).toEqual(['curl', 'https://x'])
    expect(notes('curl https://x\necho hi')).toContain('Only the first command')
  })

  it('skips comments and reports unterminated quotes', () => {
    expect(words("# fetch it\ncurl https://x # trailing")).toEqual(['curl', 'https://x'])
    expect(notes("curl 'abc")).toContain('never closed')
    expect(words("curl 'abc")).toEqual(['curl', 'abc'])
  })
})

describe('cmd words', () => {
  it('removes carets, then splits argv like the C runtime', () => {
    expect(words('curl ^"https://x/?a=1^&b=2^" -H ^"x: ^\\^"q^\\^"^"', 'cmd')).toEqual(['curl', 'https://x/?a=1&b=2', '-H', 'x: "q"'])
    expect(words('curl ^"100^%^25 ^^ ^{^}^"', 'cmd')).toEqual(['curl', '100%25 ^ {}'])
  })

  it('joins caret-newline continuations and keeps ^\\n\\n as a newline', () => {
    expect(words('curl ^"https://x^" ^\n  -H ^"a: b^"', 'cmd')).toEqual(['curl', 'https://x', '-H', 'a: b'])
    expect(words('curl --data-raw ^"one^\n\ntwo^"', 'cmd')).toEqual(['curl', '--data-raw', 'one\ntwo'])
  })

  it('reads backslash pairs back as one backslash, as the browsers wrote them', () => {
    expect(words('curl ^"C:^\\^\\temp^\\^\\^"', 'cmd')).toEqual(['curl', 'C:\\temp\\'])
  })

  it('reads plain "…" quoting too (older Chrome)', () => {
    expect(words('curl "https://x" -H "a: b" --data-raw "{\\"k\\":1}"', 'cmd')).toEqual(['curl', 'https://x', '-H', 'a: b', '--data-raw', '{"k":1}'])
  })

  it('warns about %VARS% and stops at unescaped & | < >', () => {
    expect(notes('curl ^"https://x/%TOKEN%^"', 'cmd')).toContain('%TOKEN% is not expanded')
    expect(words('curl ^"https://x^" > out.txt', 'cmd')).toEqual(['curl', 'https://x'])
    expect(notes('curl ^"https://x^" | findstr a', 'cmd')).toContain('A pipe (|) ends the curl command')
  })
})

describe('dialect detection', () => {
  it('picks cmd for caret quoting or caret line ends', () => {
    expect(detectDialect('curl ^"https://x^" ^\n  -H ^"a: b^"')).toBe('cmd')
    expect(detectDialect('C:\\tools\\curl.exe ^"https://x^"')).toBe('cmd')
    expect(detectDialect('curl "https://x" ^\n  -H "a: b"')).toBe('cmd')
    expect(detectDialect("curl 'https://x' \\\n  -H 'a: ^\"b'")).toBe('bash')
    expect(detectDialect("curl -d '^\"' https://x")).toBe('bash')
  })
})

/* ------------------------------------------------------------- fuzz */

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SHELLY = [..."'\"$\\`^%&|;<>(){}[]#!*?~=:@,.-_ \t\n\nabcXHdFuGL0123456789"]
  .concat(['-H', '-d', '--data-raw', '-b', '-u', 'curl ', '$\'', '^"', '\\\n', '^\n', '$(', '${', 'é', '😀', '\r\n', 'Authorization: Bearer ', 'token=', '{"password":"', '\\x', '\\u', '\\0'])

function randomText(next: () => number, length: number, alphabet = SHELLY) {
  let out = ''
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(next() * alphabet.length)]
  return out
}

describe('fuzz', () => {
  it('never throws or hangs on random input, end to end', () => {
    const next = rng(20261018)
    for (let round = 0; round < 1500; round++) {
      const text = (next() < 0.7 ? 'curl ' : '') + randomText(next, Math.floor(next() * 160))
      for (const dialect of ['auto', 'bash', 'cmd'] as const) {
        const parsed = parseCurl(text, dialect)
        const secrets = findSecrets(parsed)
        if (!parsed.ok) continue
        for (const target of targets) expect(typeof generate(target.id, parsed.request)).toBe('string')
        // Garbage can hold an unbalanced quote inside one word, so re-quoting
        // that word may change how the rest reads; only crashes count here
        // (secrets.test.ts checks real commands keep their shape).
        const redacted = redactInput(parsed, secrets)
        parseCurl(redacted, parsed.dialect)
      }
    }
  })

  it('quoteBash and quoteCmd read back to the exact value', () => {
    const next = rng(7)
    const alphabet = [...'abc \t\n\r\'"\\$`^%&|<>!{}[]()*?#~=;,:'].concat(['é', '€', '😀', '\x00', '\x01', '\x7f', '\u2028', 'A1'])
    for (let round = 0; round < 3000; round++) {
      const value = randomText(next, Math.floor(next() * 40), alphabet)
      const bash = tokenize(`curl ${quoteBash(value)} x`, 'bash').tokens
      expect(bash.map((t) => t.value)).toEqual(['curl', value, 'x'])
      const cmd = tokenize(`curl ${quoteCmd(value)} x`, 'cmd').tokens
      expect(cmd.map((t) => t.value)).toEqual(['curl', value, 'x'])
    }
  })

  it('stays linear on pathological input', () => {
    const size = 300_000
    const patterns = ["'", '"', '$(', '${', '`', '\\', '^"', '^', '%a', '$\'\\x', '\n-', '"$', '-H ', 'a=b; ', '{"k":"', '[', '&']
    for (const pattern of patterns) {
      const text = 'curl ' + pattern.repeat(Math.ceil(size / pattern.length))
      const started = performance.now()
      for (const dialect of ['bash', 'cmd'] as const) {
        const parsed = parseCurl(text, dialect)
        findSecrets(parsed)
      }
      // A quadratic step would take minutes at this size; linear is well under a second.
      expect(performance.now() - started, `pattern ${JSON.stringify(pattern)}`).toBeLessThan(3000)
    }
  }, 60_000)

  it('refuses inputs over the size cap', () => {
    const parsed = parseCurl('curl ' + 'a'.repeat(1_000_001))
    expect(parsed.ok).toBe(false)
  })
})

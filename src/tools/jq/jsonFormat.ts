/**
 * Re-indents JSON text without parsing it into values.
 *
 * JSON.stringify(JSON.parse(text)) changes the data it was asked to tidy:
 * 12345678901234567890 comes back rounded, 1E400 as null, 1.10 as 1.1, and a
 * repeated key silently loses all but its last value — all of which jq
 * itself would have seen. Here every string and number is copied exactly as
 * written and only the whitespace between tokens changes. Input is the same
 * as the pane's: one or more JSON documents separated by whitespace.
 */

export type FormatResult = { text: string } | { error: string }

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
// eslint-disable-next-line no-control-regex
const STRING = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y
const LITERAL = /true|false|null/y
/** A number or literal running straight into more word characters (01, truex). */
const GLUED = /[\w.+-]/

class FormatError extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message)
  }
}

function position(text: string, at: number): string {
  let line = 1
  let column = 1
  for (let i = 0; i < at && i < text.length; i++) {
    if (text[i] === '\n') {
      line++
      column = 1
    } else column++
  }
  return `line ${line}, column ${column}`
}

export function formatJson(text: string, indent: number): FormatResult {
  const len = text.length
  const out: string[] = []
  const newline = indent > 0
  const pad = (depth: number) => (newline ? `\n${' '.repeat(indent * depth)}` : '')
  const colon = newline ? ': ' : ':'
  let i = 0

  const skipSpace = () => {
    while (i < len) {
      const ch = text.charCodeAt(i)
      if (ch !== 0x20 && ch !== 0x09 && ch !== 0x0a && ch !== 0x0d) break
      i++
    }
  }

  const token = (pattern: RegExp, what: string): string => {
    pattern.lastIndex = i
    const match = pattern.exec(text)
    if (!match) throw new FormatError(`expected ${what}`, i)
    i += match[0].length
    return match[0]
  }

  const scalar = (pattern: RegExp, what: string) => {
    const value = token(pattern, what)
    if (i < len && GLUED.test(text[i])) throw new FormatError(`unexpected "${text[i]}" after ${value}`, i)
    out.push(value)
  }

  const value = (depth: number) => {
    skipSpace()
    if (i >= len) throw new FormatError('unexpected end of input', i)
    const ch = text[i]
    if (ch === '{' || ch === '[') {
      const close = ch === '{' ? '}' : ']'
      i++
      out.push(ch)
      skipSpace()
      if (text[i] === close) {
        i++
        out.push(close)
        return
      }
      for (;;) {
        out.push(pad(depth + 1))
        if (close === '}') {
          skipSpace()
          out.push(token(STRING, 'a quoted key'))
          skipSpace()
          if (text[i] !== ':') throw new FormatError('expected ":" after the key', i)
          i++
          out.push(colon)
        }
        value(depth + 1)
        skipSpace()
        if (text[i] === ',') {
          i++
          out.push(',')
          continue
        }
        if (text[i] === close) {
          i++
          out.push(pad(depth), close)
          return
        }
        throw new FormatError(i >= len ? 'unexpected end of input' : `expected "," or "${close}"`, i)
      }
    }
    if (ch === '"') out.push(token(STRING, 'a valid string'))
    else if (ch === '-' || (ch >= '0' && ch <= '9')) scalar(NUMBER, 'a number')
    else if (ch === 't' || ch === 'f' || ch === 'n') scalar(LITERAL, 'a value')
    else throw new FormatError(`unexpected "${ch}"`, i)
  }

  try {
    skipSpace()
    if (i >= len) return { error: 'Input is empty' }
    while (i < len) {
      if (out.length > 0) out.push('\n')
      value(0)
      skipSpace()
    }
  } catch (err) {
    if (err instanceof FormatError) return { error: `Input is not valid JSON: ${err.message} at ${position(text, err.at)}` }
    if (err instanceof RangeError) return { error: 'Input is nested too deeply to format' }
    throw err
  }
  return { text: out.join('') }
}

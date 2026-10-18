/**
 * A lexical JSON scanner: validates and tokenizes without building values, so
 * pretty-printing keeps every number and string exactly as sent (a JSON.parse
 * round trip would turn 12345678901234567890 into 12345678901234567000), and
 * secrets can be located by byte span inside the raw body.
 */

export type JsonTokenType = '{' | '}' | '[' | ']' | ':' | ',' | 'string' | 'number' | 'literal'

export interface JsonToken {
  type: JsonTokenType
  start: number
  end: number
}

const MAX_PRETTY_DEPTH = 64

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9'
const isWs = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r'

function scanString(text: string, at: number): number {
  let i = at + 1
  while (i < text.length) {
    const c = text.charCodeAt(i)
    if (c === 34) return i + 1
    if (c < 0x20) return -1
    if (c === 92) {
      const e = text[i + 1]
      if (e === 'u') {
        if (!/^[0-9A-Fa-f]{4}$/.test(text.slice(i + 2, i + 6))) return -1
        i += 6
      } else if (e !== undefined && '"\\/bfnrt'.includes(e)) i += 2
      else return -1
    } else i++
  }
  return -1
}

function scanNumber(text: string, at: number): number {
  let i = at
  if (text[i] === '-') i++
  if (text[i] === '0') i++
  else if (isDigit(text[i])) while (isDigit(text[i])) i++
  else return -1
  if (text[i] === '.') {
    i++
    if (!isDigit(text[i])) return -1
    while (isDigit(text[i])) i++
  }
  if (text[i] === 'e' || text[i] === 'E') {
    i++
    if (text[i] === '+' || text[i] === '-') i++
    if (!isDigit(text[i])) return -1
    while (isDigit(text[i])) i++
  }
  return i
}

/** Tokens of a complete JSON document, or null when it is not valid JSON. */
export function scanJson(text: string): JsonToken[] | null {
  const tokens: JsonToken[] = []
  const stack: string[] = []
  type State = 'value' | 'firstValue' | 'key' | 'firstKey' | 'colon' | 'after' | 'done'
  let state = 'value' as State
  let i = 0
  const n = text.length
  const settle = () => {
    state = stack.length ? 'after' : 'done'
  }
  while (i < n) {
    const c = text[i]
    if (isWs(c)) {
      i++
      continue
    }
    if (state === 'done') return null
    if (state === 'value' || state === 'firstValue') {
      if (c === ']' && state === 'firstValue') {
        stack.pop()
        tokens.push({ type: ']', start: i, end: ++i })
        settle()
      } else if (c === '{' || c === '[') {
        stack.push(c)
        tokens.push({ type: c, start: i, end: ++i })
        state = c === '{' ? 'firstKey' : 'firstValue'
      } else if (c === '"') {
        const end = scanString(text, i)
        if (end < 0) return null
        tokens.push({ type: 'string', start: i, end })
        i = end
        settle()
      } else if (c === '-' || isDigit(c)) {
        const end = scanNumber(text, i)
        if (end < 0) return null
        tokens.push({ type: 'number', start: i, end })
        i = end
        settle()
      } else {
        const word = text.startsWith('true', i) ? 4 : text.startsWith('null', i) ? 4 : text.startsWith('false', i) ? 5 : 0
        if (!word) return null
        tokens.push({ type: 'literal', start: i, end: i + word })
        i += word
        settle()
      }
    } else if (state === 'key' || state === 'firstKey') {
      if (c === '}' && state === 'firstKey') {
        stack.pop()
        tokens.push({ type: '}', start: i, end: ++i })
        settle()
      } else if (c === '"') {
        const end = scanString(text, i)
        if (end < 0) return null
        tokens.push({ type: 'string', start: i, end })
        i = end
        state = 'colon'
      } else return null
    } else if (state === 'colon') {
      if (c !== ':') return null
      tokens.push({ type: ':', start: i, end: ++i })
      state = 'value'
    } else {
      const top = stack[stack.length - 1]
      if (c === ',') {
        tokens.push({ type: ',', start: i, end: ++i })
        state = top === '{' ? 'key' : 'value'
      } else if ((c === '}' && top === '{') || (c === ']' && top === '[')) {
        stack.pop()
        tokens.push({ type: c, start: i, end: ++i })
        settle()
      } else return null
    }
  }
  return state === 'done' ? tokens : null
}

/** Re-indents valid JSON with two spaces, keeping every token verbatim. Null when not JSON or nested too deeply. */
export function prettyJson(text: string, tokens = scanJson(text)): string | null {
  if (!tokens) return null
  let depth = 0
  let out = ''
  const pad = () => '\n' + '  '.repeat(depth)
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k]
    switch (t.type) {
      case '{':
      case '[': {
        const next = tokens[k + 1]
        if (next && (next.type === '}' || next.type === ']')) {
          out += t.type + next.type
          k++
        } else {
          if (++depth > MAX_PRETTY_DEPTH) return null
          out += t.type + pad()
        }
        break
      }
      case '}':
      case ']':
        depth--
        out += pad() + t.type
        break
      case ',':
        out += ',' + pad()
        break
      case ':':
        out += ': '
        break
      default:
        out += text.slice(t.start, t.end)
    }
  }
  return out
}

export interface JsonMember {
  key: string
  /** Span of the string value's contents, inside the quotes. */
  start: number
  end: number
}

/** Every object member whose value is a string, at any depth. */
export function stringMembers(text: string, tokens = scanJson(text)): JsonMember[] {
  if (!tokens) return []
  const members: JsonMember[] = []
  for (let k = 0; k + 2 < tokens.length; k++) {
    const key = tokens[k]
    if (key.type !== 'string' || tokens[k + 1].type !== ':') continue
    const value = tokens[k + 2]
    if (value.type !== 'string') continue
    members.push({ key: JSON.parse(text.slice(key.start, key.end)) as string, start: value.start + 1, end: value.end - 1 })
  }
  return members
}

/**
 * The parsed value when a generator may print it as a literal and serialise
 * it back byte for byte: the text is already compact (what JSON.stringify
 * writes), every number is a safe integer, and no key is __proto__ (which an
 * object literal would treat as the prototype).
 */
export function exactJsonValue(text: string): unknown {
  const tokens = scanJson(text)
  if (!tokens || (tokens[0].type !== '{' && tokens[0].type !== '[')) return undefined
  for (const t of tokens) {
    if (t.type !== 'number') continue
    const raw = text.slice(t.start, t.end)
    if (!/^-?(?:0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(Number(raw)) || raw === '-0') return undefined
  }
  if (text.includes('"__proto__"')) return undefined
  const value = JSON.parse(text) as unknown
  return JSON.stringify(value) === text ? value : undefined
}

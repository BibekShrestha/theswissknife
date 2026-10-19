/**
 * A small hand-written .proto reader for the common subset: syntax/edition,
 * package, messages (nested), enums, scalar / message / enum fields with
 * optional, required and repeated labels, map<K, V>, oneof, plus reserved,
 * extensions and options, which are read past. Imports are not followed
 * (types from them stay unresolved and decode schemaless), proto2 groups
 * and extensions are skipped with a note, services are ignored.
 *
 * It only names and types fields for the decoder; it is not a validator.
 * Linear, with nesting capped, so it is safe on whatever is pasted.
 */

export const SCALARS = new Set([
  'double', 'float', 'int32', 'int64', 'uint32', 'uint64', 'sint32', 'sint64',
  'fixed32', 'fixed64', 'sfixed32', 'sfixed64', 'bool', 'string', 'bytes',
])

export interface FieldDef {
  name: string
  number: number
  label: 'optional' | 'required' | 'repeated' | ''
  /** Scalar name, or the resolved full name of a message or enum (no leading dot). */
  type: string
  kind: 'scalar' | 'message' | 'enum' | 'unknown'
  /** The type as written, for messages. */
  written: string
  map?: boolean
}

export interface MessageDef {
  fullName: string
  fields: Map<number, FieldDef>
}

export interface ProtoSchema {
  messages: Map<string, MessageDef>
  enums: Map<string, Map<number, string>>
  /** Top-level and nested message names in source order. */
  order: string[]
  errors: string[]
  notes: string[]
}

interface Token {
  t: 'id' | 'num' | 'str' | 'sym'
  v: string
  line: number
  col: number
}

const MAX_NESTING = 64
const MAX_ERRORS = 20

function tokenize(src: string, errors: string[]): Token[] {
  const out: Token[] = []
  let i = 0
  let line = 1
  let lineStart = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (c === '\n') {
      line++
      i++
      lineStart = i
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') {
      i++
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') {
          line++
          lineStart = i + 1
        }
        i++
      }
      i += 2
      continue
    }
    const col = i - lineStart + 1
    if (/[A-Za-z_.]/.test(c) && !(c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i + 1
      while (j < n && /[A-Za-z0-9_.]/.test(src[j])) j++
      out.push({ t: 'id', v: src.slice(i, j), line, col })
      i = j
      continue
    }
    if (/[0-9]/.test(c) || ((c === '-' || c === '+' || c === '.') && /[0-9.]/.test(src[i + 1] ?? ''))) {
      let j = i + 1
      while (j < n && /[0-9A-Za-z_.+-]/.test(src[j]) && !(/[+-]/.test(src[j]) && !/[eE]/.test(src[j - 1]))) j++
      out.push({ t: 'num', v: src.slice(i, j), line, col })
      i = j
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      let value = ''
      while (j < n && src[j] !== c && src[j] !== '\n') {
        if (src[j] === '\\' && j + 1 < n) {
          value += src[j + 1]
          j += 2
        } else value += src[j++]
      }
      if (src[j] !== c) errors.push(`${line}:${col}: unterminated string`)
      out.push({ t: 'str', v: value, line, col })
      i = j + 1
      continue
    }
    out.push({ t: 'sym', v: c, line, col })
    i++
  }
  return out
}

class ParseError extends Error {}

interface RawField {
  name: string
  number: number
  label: FieldDef['label']
  type: string
  scope: string
  map?: { key: string; value: string }
}

interface RawMessage {
  fullName: string
  fields: RawField[]
}

export function parseProto(src: string): ProtoSchema {
  const errors: string[] = []
  const notes: string[] = []
  const tokens = tokenize(src, errors)
  let p = 0
  let pkg = ''
  const raw: RawMessage[] = []
  const enums = new Map<string, Map<number, string>>()
  const noted = new Set<string>()
  const note = (text: string) => {
    if (!noted.has(text)) {
      noted.add(text)
      notes.push(text)
    }
  }

  const peek = (k = 0): Token | undefined => tokens[p + k]
  const where = (tok = peek()) => (tok ? `${tok.line}:${tok.col}` : 'end')
  const fail = (message: string): never => {
    throw new ParseError(`${where()}: ${message}`)
  }
  const next = (): Token => tokens[p++] ?? fail('unexpected end of file')
  const expect = (v: string) => {
    const tok = next()
    if (tok.v !== v || tok.t === 'str') {
      p--
      fail(`expected "${v}", found "${tok.v}"`)
    }
  }
  const ident = (): string => {
    const tok = next()
    if (tok.t !== 'id') {
      p--
      fail(`expected a name, found "${tok.v}"`)
    }
    return tok.v
  }
  const int = (): number => {
    const tok = next()
    const value = tok.t === 'num' ? Number(tok.v.startsWith('0x') || tok.v.startsWith('0X') ? parseInt(tok.v, 16) : tok.v) : NaN
    if (!Number.isInteger(value)) {
      p--
      fail(`expected a number, found "${tok.v}"`)
    }
    return value
  }
  /** Skips to the end of the current statement: past the next ';' or balanced '{…}' at depth 0. */
  const skipStatement = () => {
    let depth = 0
    while (p < tokens.length) {
      const tok = tokens[p]
      if (tok.t === 'sym') {
        if (tok.v === '{' || tok.v === '[' || tok.v === '(') depth++
        else if (tok.v === '}' || tok.v === ']' || tok.v === ')') {
          // A close with nothing open belongs to the enclosing block: leave it.
          if (depth === 0) return
          depth--
          if (depth === 0 && tok.v === '}') {
            p++
            return
          }
        } else if (tok.v === ';' && depth === 0) {
          p++
          return
        }
      }
      p++
    }
  }
  const skipBlock = () => {
    // From the current token to the end of a { … } block.
    while (p < tokens.length && peek()!.v !== '{') p++
    skipStatement()
  }
  const recover = (error: unknown) => {
    if (!(error instanceof ParseError)) throw error
    if (errors.length < MAX_ERRORS) errors.push(error.message)
    skipStatement()
  }

  const parseEnum = (scope: string) => {
    const name = ident()
    const full = scope ? `${scope}.${name}` : name
    const values = new Map<number, string>()
    enums.set(full, values)
    expect('{')
    while (peek() && peek()!.v !== '}') {
      const start = p
      try {
        const tok = peek()!
        if (tok.v === ';') {
          p++
          continue
        }
        if (tok.v === 'option' || tok.v === 'reserved') {
          skipStatement()
          continue
        }
        const valueName = ident()
        expect('=')
        const value = int()
        if (!values.has(value)) values.set(value, valueName)
        if (peek()?.v === '[') skipStatement()
        else expect(';')
      } catch (error) {
        if (p === start) p++
        recover(error)
      }
    }
    expect('}')
  }

  const parseField = (scope: string, fields: RawField[], label: FieldDef['label']) => {
    const type = ident()
    if (type === 'group') {
      note('proto2 groups are skipped — their fields decode without names')
      skipBlock()
      return
    }
    const name = ident()
    expect('=')
    const number = int()
    if (peek()?.v === '[') {
      while (peek() && peek()!.v !== ']') p++
      expect(']')
    }
    expect(';')
    fields.push({ name, number, label, type, scope })
  }

  const parseMessage = (scope: string, depth: number) => {
    if (depth > MAX_NESTING) fail(`messages nested more than ${MAX_NESTING} deep`)
    const name = ident()
    const full = scope ? `${scope}.${name}` : name
    const message: RawMessage = { fullName: full, fields: [] }
    raw.push(message)
    expect('{')
    parseBody(full, message, depth)
    expect('}')
  }

  const parseBody = (scope: string, message: RawMessage, depth: number, inOneof = false) => {
    while (peek() && peek()!.v !== '}') {
      const start = p
      try {
        const tok = peek()!
        switch (tok.v) {
          case ';':
            p++
            break
          case 'message':
            p++
            parseMessage(scope, depth + 1)
            break
          case 'enum':
            p++
            parseEnum(scope)
            break
          case 'oneof':
            p++
            ident()
            expect('{')
            parseBody(scope, message, depth + 1, true)
            expect('}')
            break
          case 'map': {
            if (peek(1)?.v !== '<') {
              parseField(scope, message.fields, '')
              break
            }
            p += 2
            const key = ident()
            expect(',')
            const value = ident()
            expect('>')
            const name = ident()
            expect('=')
            const number = int()
            if (peek()?.v === '[') {
              while (peek() && peek()!.v !== ']') p++
              expect(']')
            }
            expect(';')
            message.fields.push({ name, number, label: 'repeated', type: '', scope, map: { key, value } })
            break
          }
          case 'option':
          case 'reserved':
          case 'extensions':
            skipStatement()
            break
          case 'extend':
            note('extend blocks are skipped — extension fields decode without names')
            skipBlock()
            break
          case 'optional':
          case 'required':
          case 'repeated':
            if (inOneof) fail(`"${tok.v}" is not allowed inside a oneof`)
            p++
            parseField(scope, message.fields, tok.v)
            break
          default:
            if (tok.t !== 'id') fail(`unexpected "${tok.v}"`)
            parseField(scope, message.fields, '')
        }
      } catch (error) {
        if (p === start) p++
        recover(error)
      }
    }
  }

  while (p < tokens.length) {
    const start = p
    try {
      const tok = peek()!
      switch (tok.v) {
        case ';':
          p++
          break
        case 'syntax':
        case 'edition':
        case 'option':
          skipStatement()
          break
        case 'import':
          note('Imports are not followed — fields of imported types decode schemaless')
          skipStatement()
          break
        case 'package':
          p++
          pkg = ident()
          expect(';')
          break
        case 'message':
          p++
          parseMessage(pkg, 0)
          break
        case 'enum':
          p++
          parseEnum(pkg)
          break
        case 'service':
          skipBlock()
          break
        case 'extend':
          note('extend blocks are skipped — extension fields decode without names')
          skipBlock()
          break
        default:
          fail(`unexpected "${tok.v}" at the top level`)
      }
    } catch (error) {
      if (p === start) p++
      recover(error)
    }
  }

  // Resolve type names the way protoc does: innermost scope outward.
  const messages = new Map<string, MessageDef>()
  for (const m of raw) messages.set(m.fullName, { fullName: m.fullName, fields: new Map() })
  const resolve = (name: string, scope: string): { kind: FieldDef['kind']; type: string } => {
    if (SCALARS.has(name)) return { kind: 'scalar', type: name }
    if (name.startsWith('.')) {
      const exact = name.slice(1)
      if (messages.has(exact)) return { kind: 'message', type: exact }
      if (enums.has(exact)) return { kind: 'enum', type: exact }
      return { kind: 'unknown', type: exact }
    }
    const parts = scope ? scope.split('.') : []
    for (let i = parts.length; i >= 0; i--) {
      const candidate = [...parts.slice(0, i), name].join('.')
      if (messages.has(candidate)) return { kind: 'message', type: candidate }
      if (enums.has(candidate)) return { kind: 'enum', type: candidate }
    }
    return { kind: 'unknown', type: name }
  }
  for (const m of raw) {
    const def = messages.get(m.fullName)!
    for (const f of m.fields) {
      if (def.fields.has(f.number)) {
        if (errors.length < MAX_ERRORS) errors.push(`${m.fullName}: field number ${f.number} is used twice`)
        continue
      }
      if (f.map) {
        const entryName = `${m.fullName}.${f.name.replace(/(^|_)([a-z])/g, (_, __, ch: string) => ch.toUpperCase())}Entry`
        const entry: MessageDef = { fullName: entryName, fields: new Map() }
        const key = resolve(f.map.key, m.fullName)
        const value = resolve(f.map.value, m.fullName)
        entry.fields.set(1, { name: 'key', number: 1, label: '', type: key.type, kind: key.kind, written: f.map.key })
        entry.fields.set(2, { name: 'value', number: 2, label: '', type: value.type, kind: value.kind, written: f.map.value })
        messages.set(entryName, entry)
        def.fields.set(f.number, { name: f.name, number: f.number, label: 'repeated', type: entryName, kind: 'message', written: `map<${f.map.key}, ${f.map.value}>`, map: true })
        continue
      }
      const r = resolve(f.type, f.scope)
      if (r.kind === 'unknown') note(`Type "${f.type}" is not defined here — fields of that type decode schemaless`)
      def.fields.set(f.number, { name: f.name, number: f.number, label: f.label, type: r.type, kind: r.kind, written: f.type })
    }
  }
  return { messages, enums, order: raw.map((m) => m.fullName), errors, notes }
}

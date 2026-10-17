import { Document, LineCounter, isAlias, isCollection, isScalar, parseDocument, visit, type Node as YamlNode } from 'yaml'
import { TomlDate, TomlError, parse as parseToml, stringify as stringifyToml } from 'smol-toml'

/**
 * YAML ⇄ JSON ⇄ TOML. Every input is parsed into one value model, every
 * output is written from it, and anything the trip cannot carry is reported
 * as a note rather than dropped quietly.
 *
 * The model: `bigint` is an integer, `number` is a float (so TOML's `1.0`
 * stays a float and `2^53 + 1` stays exact), `TomlDate` only arrives from
 * TOML input, objects are null-prototype so a `__proto__` key is just a key.
 */

export type Format = 'json' | 'yaml' | 'toml'
export type InputFormat = Format | 'auto'

export type Value = null | boolean | string | number | bigint | TomlDate | Value[] | { [key: string]: Value }
type Obj = { [key: string]: Value }

export interface Note {
  level: 'warn' | 'info'
  text: string
  /** Where it happened: input line refs ("line 3: no") or value paths (".a.b[0]"). */
  items?: string[]
}

export interface ConvertError {
  message: string
  /** 1-based, in the input. Absent for errors that are about the output. */
  line?: number
  column?: number
  side: 'input' | 'output'
}

export interface ConvertOptions {
  from: InputFormat
  to: Format
  indent: 2 | 4
  sortKeys: boolean
}

export interface ConvertResult {
  /** The format the input was read as (the guess, when `from` is auto). */
  format?: Format
  /** Set when auto-detect had to guess from a failed parse. */
  guessed?: boolean
  output: string
  error?: ConvertError
  notes: Note[]
}

export const formats: { id: Format; label: string; ext: string; mime: string }[] = [
  { id: 'json', label: 'JSON', ext: 'json', mime: 'application/json' },
  { id: 'yaml', label: 'YAML', ext: 'yaml', mime: 'application/yaml' },
  { id: 'toml', label: 'TOML', ext: 'toml', mime: 'application/toml' },
]

export const formatLabel = (format: Format) => formats.find((item) => item.id === format)!.label

class ParseError extends Error {
  constructor(message: string, readonly line?: number, readonly column?: number) {
    super(message)
  }
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)
const INT64_MIN = -(2n ** 63n)
const INT64_MAX = 2n ** 63n - 1n

/* ---------------------------------------------------------------- paths */

const IDENT = /^[A-Za-z_][A-Za-z0-9_-]*$/
export function childPath(base: string, key: string | number) {
  if (typeof key === 'number') return `${base}[${key}]`
  return IDENT.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`
}
const shown = (path: string) => path || '.'

/** Collects paths per note so each note is listed once with its places. */
class Notes {
  private map = new Map<string, Note>()
  add(level: Note['level'], text: string, item?: string) {
    let note = this.map.get(text)
    if (!note) this.map.set(text, note = { level, text, items: [] })
    if (item !== undefined && !note.items!.includes(item)) note.items!.push(item)
  }
  list(): Note[] {
    return [...this.map.values()].map((note) => note.items!.length ? note : { level: note.level, text: note.text })
  }
}

const newObj = (): Obj => Object.create(null) as Obj

/* ------------------------------------------------------------------ JSON */

function lineCol(text: string, offset: number) {
  let line = 1
  let last = -1
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) { line++; last = i }
  }
  return { line, column: offset - last }
}

/**
 * A strict JSON (RFC 8259) parser of our own: JSON.parse rounds integers past
 * 2^53, keeps the last of two duplicate keys without a word, forgets that
 * `1.0` was written as a float, and words its errors differently in each
 * browser (some without a position).
 */
export function parseJson(text: string): Value {
  let i = 0
  const fail = (message: string, at = i): never => {
    const { line, column } = lineCol(text, at)
    throw new ParseError(message, line, column)
  }
  const describe = (at: number) => at >= text.length ? 'end of input' : `'${String.fromCodePoint(text.codePointAt(at)!)}'`
  const ws = () => {
    for (;;) {
      const c = text.charCodeAt(i)
      if (c === 32 || c === 9 || c === 10 || c === 13) i++
      else if (c === 47 && (text[i + 1] === '/' || text[i + 1] === '*')) fail('Comments are not allowed in JSON')
      else return
    }
  }
  const string = (): string => {
    const start = i++
    let out = ''
    let run = i
    for (;;) {
      if (i >= text.length) fail('Unterminated string', start)
      const c = text.charCodeAt(i)
      if (c === 34) { out += text.slice(run, i++); return out }
      if (c < 32) fail(c === 10 ? 'Unterminated string (raw line break inside a string)' : 'Control character inside a string must be escaped')
      if (c !== 92) { i++; continue }
      out += text.slice(run, i)
      const e = text[i + 1]
      const simple: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }
      if (e in simple) { out += simple[e]; i += 2 } else if (e === 'u') {
        const hex = text.slice(i + 2, i + 6)
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('Invalid \\u escape (needs four hex digits)')
        out += String.fromCharCode(parseInt(hex, 16))
        i += 6
      } else fail(`Invalid escape '\\${e ?? ''}'`)
      run = i
    }
  }
  const NUMBER = /-?(?:0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y
  const number = (): Value => {
    NUMBER.lastIndex = i
    const match = NUMBER.exec(text)
    if (!match) fail(`Unexpected ${describe(i)}, expected a value`)
    const raw = match![0]
    const next = text[i + raw.length]
    if (next && /[0-9.eExX+\-]/.test(next)) fail(`Invalid number (${/[0-9]/.test(next) && raw.replace('-', '') === '0' ? 'leading zeros are not allowed' : `unexpected '${next}'`})`, i + raw.length)
    i += raw.length
    return match![1] || match![2] ? Number(raw) : BigInt(raw)
  }
  const value = (depth: number): Value => {
    if (depth > 2000) fail('Nested too deeply')
    ws()
    const c = text[i]
    if (c === '{') {
      i++
      const obj = newObj()
      ws()
      if (text[i] === '}') { i++; return obj }
      for (;;) {
        ws()
        if (text[i] !== '"') fail(text[i] === '}' ? 'Trailing comma before }' : `Unexpected ${describe(i)}, expected a "quoted" key`)
        const keyAt = i
        const key = string()
        if (Object.prototype.hasOwnProperty.call(obj, key)) fail(`Duplicate key ${JSON.stringify(key)}`, keyAt)
        ws()
        if (text[i] !== ':') fail(`Unexpected ${describe(i)}, expected ':' after the key`)
        i++
        obj[key] = value(depth + 1)
        ws()
        if (text[i] === ',') { i++; continue }
        if (text[i] === '}') { i++; return obj }
        fail(`Unexpected ${describe(i)}, expected ',' or '}'`)
      }
    }
    if (c === '[') {
      i++
      const arr: Value[] = []
      ws()
      if (text[i] === ']') { i++; return arr }
      for (;;) {
        ws()
        if (text[i] === ']') fail('Trailing comma before ]')
        arr.push(value(depth + 1))
        ws()
        if (text[i] === ',') { i++; continue }
        if (text[i] === ']') { i++; return arr }
        fail(`Unexpected ${describe(i)}, expected ',' or ']'`)
      }
    }
    if (c === '"') return string()
    for (const [word, result] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(word, i)) { i += word.length; return result }
    }
    if (c === "'") fail('JSON strings need double quotes')
    return number()
  }
  if (text.charCodeAt(0) === 0xfeff) i = 1
  ws()
  if (i >= text.length) fail('Empty input')
  const result = value(0)
  ws()
  if (i < text.length) fail(`Unexpected ${describe(i)} after the JSON value`)
  return result
}

/* ------------------------------------------------------------------ YAML */

// Hints skip the one-letter y/n (coordinates, flags) to stay quiet; output
// still quotes them, since some 1.1 readers (Go's yaml.v2) take them as bools.
const YAML11_BOOL = /^(?:yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF)$/
const YAML11_BOOL_ANY = /^(?:y|Y|n|N|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF)$/
const YAML11_SEXAGESIMAL = /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+(?:\.[0-9_]*)?$/
const YAML11_OCTAL = /^[-+]?0[0-7_]+$/

function stripYamlPosition(message: string) {
  return message.replace(/ at line \d+, column \d+:[\s\S]*$/, '').trim()
}

function toBase64(bytes: Uint8Array) {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function parseYaml(text: string, notes: Notes): Value {
  const lineCounter = new LineCounter()
  const doc = parseDocument(text, { intAsBigInt: true, merge: true, lineCounter })
  const first = doc.errors[0]
  if (first) throw new ParseError(stripYamlPosition(first.message), first.linePos?.[0].line, first.linePos?.[0].col)
  const at = (node: { range?: [number, number, number] | null }) => {
    const pos = node.range ? lineCounter.linePos(node.range[0]) : undefined
    return pos ? `line ${pos.line}` : ''
  }

  for (const warning of doc.warnings) {
    if (warning.code !== 'TAG_RESOLVE_FAILED') notes.add('warn', stripYamlPosition(warning.message), warning.linePos ? `line ${warning.linePos[0].line}` : undefined)
  }
  if (doc.commentBefore || doc.comment) notes.add('info', 'Comments are not carried over.')
  visit(doc, (key, node) => {
    if (isAlias(node)) notes.add('info', 'Anchors and aliases are expanded: each alias is written out in full.', `${at(node)}: *${node.source}`)
    if (!isScalar(node) && !isCollection(node)) return
    const n = node as YamlNode
    if (n.comment || n.commentBefore) notes.add('info', 'Comments are not carried over.')
    if (n.anchor) notes.add('info', 'Anchors and aliases are expanded: each alias is written out in full.', `${at(n)}: &${n.anchor}`)
    if (n.tag) notes.add('warn', 'Tags are not preserved — the tagged value is converted as plain data (!!binary becomes base64 text, !!set a list, unknown tags are ignored).', `${at(n)}: ${n.tag.replace('tag:yaml.org,2002:', '!!')}`)
    if (isScalar(node) && node.type === 'PLAIN' && typeof node.source === 'string') {
      const src = node.source
      if (typeof node.value === 'string' && YAML11_BOOL.test(src)) notes.add('info', 'Read as strings under YAML 1.2. YAML 1.1 parsers (PyYAML, older tools) read these as booleans — the "Norway problem". Quote them in the source if they are meant as text.', `${at(node)}: ${src}`)
      else if (typeof node.value === 'string' && YAML11_SEXAGESIMAL.test(src)) notes.add('info', 'Read as strings under YAML 1.2; YAML 1.1 parsers read these as base-60 numbers.', `${at(node)}: ${src}`)
      else if (typeof node.value === 'bigint' && YAML11_OCTAL.test(src)) notes.add('info', 'Read as decimal integers under YAML 1.2; YAML 1.1 parsers read a leading 0 as octal.', `${at(node)}: ${src}`)
      if (src === '<<' && key === 'key') notes.add('info', 'Merge keys (<<) are expanded into the mapping that uses them.', `${at(node)}: <<`)
    }
  })

  let js: unknown
  try {
    js = doc.toJS({ mapAsMap: true })
  } catch (error) {
    throw new ParseError(error instanceof Error ? error.message : String(error))
  }
  return fromYamlJs(js, '', new Set(), notes)
}

function fromYamlJs(value: unknown, path: string, ancestors: Set<object>, notes: Notes): Value {
  if (value === null || value === undefined) return null
  switch (typeof value) {
    case 'string': case 'boolean': case 'number': case 'bigint': return value
  }
  if (value instanceof Uint8Array) return toBase64(value)
  if (value instanceof Date) return value.toISOString()
  if (typeof value !== 'object') return String(value)
  if (ancestors.has(value)) throw new ParseError(`Recursive alias at ${shown(path)} — the value contains itself and cannot be written out`)
  ancestors.add(value)
  try {
    if (Array.isArray(value) || value instanceof Set) {
      return [...value].map((item, index) => fromYamlJs(item, childPath(path, index), ancestors, notes))
    }
    if (value instanceof Map) {
      const obj = newObj()
      for (const [rawKey, item] of value) {
        let key: string
        if (typeof rawKey === 'string') key = rawKey
        else {
          key = rawKey === null || rawKey === undefined ? '' : typeof rawKey === 'object' ? JSON.stringify(fromYamlJs(rawKey, path, new Set(), new Notes()), jsonReplacer) : String(rawKey)
          notes.add('warn', 'Non-string keys became strings (JSON and TOML keys are always strings).', childPath(path, key))
        }
        if (Object.prototype.hasOwnProperty.call(obj, key)) throw new ParseError(`Two keys become ${JSON.stringify(key)} once written as strings (at ${shown(path)})`)
        obj[key] = fromYamlJs(item, childPath(path, key), ancestors, notes)
      }
      return obj
    }
    return String(value)
  } finally {
    ancestors.delete(value)
  }
}

const jsonReplacer = (_key: string, value: unknown) => typeof value === 'bigint' ? Number(value) : value

/** Plain scalars that a YAML 1.1 parser would not read as the same string. */
function yaml11Ambiguous(value: string) {
  return YAML11_BOOL_ANY.test(value) || YAML11_SEXAGESIMAL.test(value) || YAML11_OCTAL.test(value)
}

function writeYaml(value: Value, indent: number): string {
  const doc = new Document(value, { keepUndefined: false })
  visit(doc, {
    Scalar(_key, node) {
      // `1.0` must stay a float on the way back in.
      if (typeof node.value === 'number' && Number.isInteger(node.value)) node.minFractionDigits = 1
      // YAML 1.2 writes `no` bare; quote it so YAML 1.1 readers agree.
      if (typeof node.value === 'string' && yaml11Ambiguous(node.value)) node.type = 'QUOTE_DOUBLE'
    },
  })
  return doc.toString({ indent, lineWidth: 0 })
}

/* ------------------------------------------------------------------ TOML */

/** smol-toml has no comment API; this skips strings to find a real `#`. */
export function tomlHasComment(text: string) {
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '#') return true
    if (c !== '"' && c !== "'") continue
    const triple = text.startsWith(c.repeat(3), i)
    const close = triple ? c.repeat(3) : c
    i += close.length
    while (i < text.length && !text.startsWith(close, i)) {
      if (!triple && text[i] === '\n') break
      if (c === '"' && text[i] === '\\') i++
      i++
    }
    i += close.length - 1
    if (triple) while (text[i + 1] === c) i++
  }
  return false
}

function parseTomlText(text: string, notes: Notes): Value {
  let parsed: unknown
  try {
    parsed = parseToml(text, { integersAsBigInt: true })
  } catch (error) {
    if (error instanceof TomlError) {
      const message = error.message.split('\n')[0].replace(/^Invalid TOML document: /, '')
      throw new ParseError(message.charAt(0).toUpperCase() + message.slice(1), error.line, error.column)
    }
    throw error
  }
  if (tomlHasComment(text)) notes.add('info', 'Comments are not carried over.')
  return fromToml(parsed)
}

function fromToml(value: unknown): Value {
  if (Array.isArray(value)) return value.map(fromToml)
  if (value instanceof TomlDate) return value
  if (value && typeof value === 'object') {
    const obj = newObj()
    for (const key of Object.keys(value)) obj[key] = fromToml((value as Record<string, unknown>)[key])
    return obj
  }
  return value as Value
}

function kindOf(value: Value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  if (typeof value === 'string') return 'a string'
  if (typeof value === 'bigint' || typeof value === 'number') return 'a number'
  if (typeof value === 'boolean') return 'a boolean'
  return 'a scalar'
}

/**
 * TOML has no null. Our rule: a key whose value is null is dropped and
 * listed; a null inside an array is refused, because dropping it would
 * shift every later index.
 */
function prepareToml(value: Value, path: string, notes: Notes): Value {
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      const at = childPath(path, index)
      if (item === null) throw new ConvertFail(`TOML has no null, and dropping it from the array at ${shown(path)} would shift the items after it (${shown(at)} is null).`)
      return prepareToml(item, at, notes)
    })
  }
  if (typeof value === 'bigint' && (value < INT64_MIN || value > INT64_MAX)) {
    throw new ConvertFail(`${shown(path)} is ${value}, outside TOML's 64-bit integer range.`)
  }
  if (isObj(value)) {
    const obj = newObj()
    for (const key of Object.keys(value)) {
      const at = childPath(path, key)
      if (value[key] === null) { notes.add('warn', 'TOML has no null — these keys were dropped:', at); continue }
      obj[key] = prepareToml(value[key], at, notes)
    }
    return obj
  }
  return value
}

/* ------------------------------------------------------------------ JSON out */

const isObj = (value: Value): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof TomlDate)

function tomlDateString(date: TomlDate) {
  return date.toISOString().replace(/\.000(?=$|Z|[+-])/, '')
}

function writeJson(value: Value, indent: number, notes: Notes): string {
  const pad = ' '.repeat(indent)
  const write = (item: Value, path: string, depth: string): string => {
    if (item === null) return 'null'
    if (typeof item === 'boolean') return String(item)
    if (typeof item === 'string') return JSON.stringify(item)
    if (typeof item === 'bigint') {
      if (item > MAX_SAFE || item < -MAX_SAFE) notes.add('warn', 'Integers beyond ±2^53 are written exactly, but JavaScript\'s JSON.parse and other parsers that read numbers as doubles will round them:', shown(path))
      return item.toString()
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) {
        notes.add('warn', 'JSON has no NaN or infinity — written as null:', shown(path))
        return 'null'
      }
      if (Object.is(item, -0)) return '-0.0'
      const text = String(item)
      return Number.isInteger(item) && !/e/i.test(text) ? `${text}.0` : text
    }
    if (item instanceof TomlDate) return JSON.stringify(tomlDateString(item))
    const inner = depth + pad
    if (Array.isArray(item)) {
      if (!item.length) return '[]'
      const parts = item.map((child, index) => write(child, childPath(path, index), inner))
      return `[\n${parts.map((part) => inner + part).join(',\n')}\n${depth}]`
    }
    const keys = Object.keys(item)
    if (!keys.length) return '{}'
    const parts = keys.map((key) => `${JSON.stringify(key)}: ${write(item[key], childPath(path, key), inner)}`)
    return `{\n${parts.map((part) => inner + part).join(',\n')}\n${depth}}`
  }
  return `${write(value, '', '')}\n`
}

/* ------------------------------------------------------------------ shared */

class ConvertFail extends Error {}

function sortValue(value: Value): Value {
  if (Array.isArray(value)) return value.map(sortValue)
  if (!isObj(value)) return value
  const obj = newObj()
  for (const key of Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) obj[key] = sortValue(value[key])
  return obj
}

/** TOML dates leave TOML as strings; YAML is given the same text. */
function datesToStrings(value: Value, path: string, notes: Notes): Value {
  if (value instanceof TomlDate) {
    notes.add('warn', 'TOML dates and times became plain strings:', shown(path))
    return tomlDateString(value)
  }
  if (Array.isArray(value)) return value.map((item, index) => datesToStrings(item, childPath(path, index), notes))
  if (isObj(value)) {
    const obj = newObj()
    for (const key of Object.keys(value)) obj[key] = datesToStrings(value[key], childPath(path, key), notes)
    return obj
  }
  return value
}

function parseAs(format: Format, text: string, notes: Notes): Value {
  if (format === 'json') return parseJson(text)
  if (format === 'yaml') return parseYaml(text, notes)
  return parseTomlText(text, notes)
}

const TOML_LINE = /^\s*(?:\[\[?[^\]\n]+\]\]?|[A-Za-z0-9_."'-]+(?:\s*\.\s*[A-Za-z0-9_"'-]+)*\s*=)/m

/**
 * Tries the strict formats first: JSON, then TOML (`a = 1` is also a valid
 * YAML string, so YAML — which accepts almost anything — comes last). If
 * nothing parses, guesses from the shape so the error shown is the useful one.
 */
export function detectFormat(text: string): { format: Format; value?: Value; notes: Notes; error?: ParseError } {
  const attempts: Format[] = ['json', 'toml', 'yaml']
  const trimmed = text.trimStart()
  const firstLine = trimmed.split('\n')[0]
  const tomlHeader = /^\[\[?[^\]]*\]\]?\s*(?:#.*)?$/.test(firstLine)
  const jsonShaped = /^[{["]/.test(trimmed) && !tomlHeader
  let jsonError: ParseError | undefined
  for (const format of attempts) {
    const notes = new Notes()
    try {
      const value = parseAs(format, text, notes)
      // `{a: 1,}` is fine YAML; say so rather than let a JSON typo pass unseen.
      if (format === 'yaml' && jsonShaped && jsonError) {
        const where = jsonError.line ? ` at line ${jsonError.line}, column ${jsonError.column}` : ''
        notes.add('warn', `Not valid JSON (${jsonError.message}${where}), so it was read as YAML. Pick JSON as the input format to see only the JSON error.`)
      }
      return { format, value, notes }
    } catch (error) {
      if (!(error instanceof ParseError)) throw error
      if (format === 'json') jsonError = error
    }
  }
  const yamlKey = /^\s*[\w"'-]+\s*:(?:\s|$)/m.test(text)
  const format: Format = jsonShaped ? 'json' : TOML_LINE.test(text) && !yamlKey ? 'toml' : 'yaml'
  const notes = new Notes()
  try {
    parseAs(format, text, notes)
  } catch (error) {
    if (error instanceof ParseError) return { format, notes, error }
    throw error
  }
  return { format, notes }
}

export function convert(text: string, options: ConvertOptions): ConvertResult {
  if (!text.trim()) return { output: '', notes: [], format: options.from === 'auto' ? undefined : options.from }
  let format: Format
  let value: Value
  let notes: Notes
  let guessed = false
  if (options.from === 'auto') {
    const detected = detectFormat(text)
    format = detected.format
    notes = detected.notes
    if (detected.error || detected.value === undefined) {
      const error = detected.error ?? new ParseError('Could not read the input')
      return { format, guessed: true, output: '', notes: [], error: { message: error.message, line: error.line, column: error.column, side: 'input' } }
    }
    value = detected.value
  } else {
    format = options.from
    notes = new Notes()
    try {
      value = parseAs(format, text, notes)
    } catch (error) {
      if (!(error instanceof ParseError)) throw error
      return { format, output: '', notes: [], error: { message: error.message, line: error.line, column: error.column, side: 'input' } }
    }
  }

  try {
    if (options.sortKeys) value = sortValue(value)
    let output: string
    if (options.to === 'toml') {
      if (!isObj(value)) throw new ConvertFail(`TOML needs a table (key/value pairs) at the top level, but this input is ${kindOf(value)}. Wrap it in a key first.`)
      output = stringifyToml(prepareToml(value, '', notes), { numbersAsFloat: true })
    } else {
      if (format === 'toml') value = datesToStrings(value, '', notes)
      output = options.to === 'json' ? writeJson(value, options.indent, notes) : writeYaml(value, options.indent)
    }
    return { format, guessed, output, notes: notes.list() }
  } catch (error) {
    if (error instanceof ConvertFail) return { format, guessed, output: '', notes: notes.list(), error: { message: error.message, side: 'output' } }
    throw error
  }
}

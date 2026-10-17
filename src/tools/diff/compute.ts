import { createInterner, diffSequences } from './myers'

export type DiffMode = 'text' | 'json'

export interface DiffOptions {
  mode: DiffMode
  /** Text mode: ignore leading/trailing whitespace and the width of inner runs. */
  ignoreWhitespace: boolean
  ignoreCase: boolean
}

/** A stretch of the output: equal lines, or lines removed from a and/or added in b. */
export interface Block {
  type: 'equal' | 'change'
  aStart: number
  aEnd: number
  bStart: number
  bEnd: number
}

/** A piece of a changed line; `changed` marks the words that differ from its partner. */
export type Segment = [text: string, changed: boolean]

export interface Side {
  lines: string[]
  /** The text does not end with a line break. */
  noEol: boolean
  eol: 'LF' | 'CRLF' | 'CR' | 'mixed' | 'none'
}

export interface DiffResult {
  a: Side
  b: Side
  blocks: Block[]
  /** Word-level highlights for paired changed lines, by line index. */
  inlineA: Record<number, Segment[]>
  inlineB: Record<number, Segment[]>
  added: number
  removed: number
  notes: string[]
}

export interface DiffError {
  error: string
}

export function computeDiff(left: string, right: string, options: DiffOptions): DiffResult | DiffError {
  const notes: string[] = []
  if (options.mode === 'json') {
    const a = canonicalJson(left, 'Original')
    if ('error' in a) return a
    const b = canonicalJson(right, 'Changed')
    if ('error' in b) return b
    left = a.text
    right = b.text
    if (a.duplicates || b.duplicates) notes.push(`Duplicate keys: JSON.parse keeps the last value, so earlier ones are not compared (${[...a.duplicates ? ['original'] : [], ...b.duplicates ? ['changed'] : []].join(', ')}).`)
  }

  const a = splitLines(left)
  const b = splitLines(right)
  if (options.mode === 'text' && a.eol !== b.eol && a.eol !== 'none' && b.eol !== 'none') {
    notes.push(`Line endings differ (original ${a.eol}, changed ${b.eol}) — ignored, lines are compared by content.`)
  }

  const key = (line: string) => {
    let k = line
    if (options.mode === 'text' && options.ignoreWhitespace) k = k.trim().replace(/\s+/g, ' ')
    if (options.mode === 'text' && options.ignoreCase) k = k.toLowerCase()
    return k
  }
  const intern = createInterner()
  const ids = (side: Side) => {
    const out = new Int32Array(side.lines.length)
    side.lines.forEach((line, i) => { out[i] = intern(key(line)) })
    // A missing final newline is a real difference (git shows it), so the
    // last line only matches a last line in the same state.
    if (side.noEol && side.lines.length) out[out.length - 1] = intern(`${key(side.lines[side.lines.length - 1])}\u0000noeol`)
    return out
  }
  if (a.noEol !== b.noEol && a.lines.length && b.lines.length) notes.push(`Only the ${a.noEol ? 'original' : 'changed'} text is missing a newline at the end.`)

  const blocks = toBlocks(diffSequences(ids(a), ids(b)), a.lines.length, b.lines.length)
  const inlineA: Record<number, Segment[]> = {}
  const inlineB: Record<number, Segment[]> = {}
  let added = 0
  let removed = 0
  let pairBudget = 20_000
  for (const block of blocks) {
    if (block.type !== 'change') continue
    removed += block.aEnd - block.aStart
    added += block.bEnd - block.bStart
    const pairs = Math.min(block.aEnd - block.aStart, block.bEnd - block.bStart)
    for (let i = 0; i < pairs && pairBudget > 0; i++, pairBudget--) {
      const inline = diffWords(a.lines[block.aStart + i], b.lines[block.bStart + i])
      if (!inline) continue
      inlineA[block.aStart + i] = inline[0]
      inlineB[block.bStart + i] = inline[1]
    }
  }
  return { a, b, blocks, inlineA, inlineB, added, removed, notes }
}

export function splitLines(text: string): Side {
  if (text === '') return { lines: [], noEol: false, eol: 'none' }
  const crlf = text.split('\r\n').length - 1
  const cr = (text.match(/\r(?!\n)/g) ?? []).length
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length
  const kinds = [crlf && 'CRLF', cr && 'CR', lf && 'LF'].filter(Boolean) as Side['eol'][]
  const eol = kinds.length === 0 ? 'none' : kinds.length > 1 ? 'mixed' : kinds[0]
  const lines = text.split(/\r\n|\r|\n/)
  const noEol = lines[lines.length - 1] !== ''
  if (!noEol) lines.pop()
  return { lines, noEol, eol }
}

function toBlocks(matches: { aStart: number; bStart: number; length: number }[], aLength: number, bLength: number): Block[] {
  const blocks: Block[] = []
  let ai = 0
  let bi = 0
  for (const m of [...matches, { aStart: aLength, bStart: bLength, length: 0 }]) {
    if (m.aStart > ai || m.bStart > bi) blocks.push({ type: 'change', aStart: ai, aEnd: m.aStart, bStart: bi, bEnd: m.bStart })
    if (m.length) blocks.push({ type: 'equal', aStart: m.aStart, aEnd: m.aStart + m.length, bStart: m.bStart, bEnd: m.bStart + m.length })
    ai = m.aStart + m.length
    bi = m.bStart + m.length
  }
  return blocks
}

const WORD = /\s+|[\p{L}\p{N}_]+|./gsu
const MAX_INLINE_CHARS = 2000

/**
 * Word-level diff of two paired lines. Returns null when highlighting would
 * not help: the lines are huge, or so different that nearly everything would
 * be marked.
 */
export function diffWords(left: string, right: string): [Segment[], Segment[]] | null {
  if (left.length > MAX_INLINE_CHARS || right.length > MAX_INLINE_CHARS) return null
  const lt = left.match(WORD) ?? []
  const rt = right.match(WORD) ?? []
  const intern = createInterner()
  const matches = diffSequences(lt.map(intern), rt.map(intern))
  const same = matches.reduce((sum, m) => sum + lt.slice(m.aStart, m.aStart + m.length).join('').length, 0)
  if (same === 0 || same < 0.4 * Math.max(left.length, right.length)) return null

  const build = (tokens: string[], start: 'aStart' | 'bStart') => {
    const out: Segment[] = []
    const add = (text: string, changed: boolean) => {
      if (!text) return
      const last = out[out.length - 1]
      if (last && last[1] === changed) last[0] += text
      else out.push([text, changed])
    }
    let i = 0
    for (const m of matches) {
      add(tokens.slice(i, m[start]).join(''), true)
      add(tokens.slice(m[start], m[start] + m.length).join(''), false)
      i = m[start] + m.length
    }
    add(tokens.slice(i).join(''), true)
    return out
  }
  return [build(lt, 'aStart'), build(rt, 'bStart')]
}

/** Marks an integer literal that JSON.parse would round (beyond 2^53). */
class RawNumber {
  constructor(readonly source: string) {}
}

/**
 * Parses JSON and re-prints it with sorted keys and two-space indent, so key
 * order and formatting stop mattering. Integers too large for a double keep
 * their source digits where the browser exposes them (JSON.parse source text
 * access), so 9007199254740993 and …992 still differ.
 */
export function canonicalJson(text: string, label: string): { text: string; duplicates: boolean } | DiffError {
  if (!text.trim()) return { text: '', duplicates: false }
  let value: unknown
  try {
    value = JSON.parse(text, (_key, v, context?: { source?: string }) => {
      if (typeof v === 'number' && context?.source && /^-?\d+$/.test(context.source) && !Number.isSafeInteger(v)) return new RawNumber(context.source)
      return v
    })
  } catch (error) {
    return { error: `${label} is not valid JSON: ${(error as Error).message}` }
  }
  return { text: `${stringify(value, '')}\n`, duplicates: hasDuplicateKeys(text) }
}

function stringify(value: unknown, indent: string): string {
  if (value instanceof RawNumber) return value.source
  if (Array.isArray(value)) {
    if (!value.length) return '[]'
    const inner = indent + '  '
    return `[\n${value.map((v) => inner + stringify(v, inner)).join(',\n')}\n${indent}]`
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    if (!keys.length) return '{}'
    const inner = indent + '  '
    return `{\n${keys.map((k) => `${inner}${JSON.stringify(k)}: ${stringify((value as Record<string, unknown>)[k], inner)}`).join(',\n')}\n${indent}}`
  }
  return JSON.stringify(value)
}

/** Scans already-valid JSON for an object that repeats a key. */
function hasDuplicateKeys(text: string): boolean {
  const stack: (Set<string> | null)[] = []
  let expectKey = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      let j = i + 1
      while (text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      const top = stack[stack.length - 1]
      if (expectKey && top) {
        const key = JSON.parse(text.slice(i, j + 1)) as string
        if (top.has(key)) return true
        top.add(key)
        expectKey = false
      }
      i = j
    } else if (c === '{') { stack.push(new Set()); expectKey = true }
    else if (c === '[') { stack.push(null); expectKey = false }
    else if (c === '}' || c === ']') stack.pop()
    else if (c === ',') expectKey = stack[stack.length - 1] != null
  }
  return false
}

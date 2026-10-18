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

/**
 * One side as `patch` sees it: split on LF only, so each line keeps any CR
 * it carries (a CRLF line ends in "\r"; a CR-only file is one line).
 */
export interface PatchSide {
  lines: string[]
  noEol: boolean
}

/** What unifiedPatch writes from: lines in patch's own terms, and their diff. */
export interface PatchView {
  a: PatchSide
  b: PatchSide
  blocks: Block[]
}

export interface DiffResult {
  a: Side
  b: Side
  blocks: Block[]
  /**
   * The patch's own line diff, or null in JSON mode (a patch of the re-printed
   * documents would apply to neither input). Shares `a`/`b`/`blocks` when
   * neither text holds a CR, because the two views are then the same.
   */
  patch: PatchView | null
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
    notes.push(`Line endings differ (original ${a.eol}, changed ${b.eol}) — ignored here, lines are compared by content; ${options.ignoreWhitespace ? 'with whitespace ignored, the patch ignores them too' : 'the patch converts them'}.`)
  }

  const key = (line: string) => {
    let k = line
    if (options.mode === 'text' && options.ignoreWhitespace) k = k.trim().replace(/\s+/g, ' ')
    if (options.mode === 'text' && options.ignoreCase) k = k.toLowerCase()
    return k
  }
  const intern = createInterner()
  const ids = (side: { lines: string[]; noEol: boolean }) => {
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

  let patch: PatchView | null = null
  if (options.mode === 'text') {
    if (!left.includes('\r') && !right.includes('\r')) patch = { a, b, blocks }
    else {
      // patch and git apply split on LF only and compare the bytes, CR
      // included: diff that view separately, so CRLF lines keep their CR, a
      // line-ending-only change becomes a change, and a stray CR stays inside
      // its line.
      const pa = splitOnLf(left)
      const pb = splitOnLf(right)
      patch = { a: pa, b: pb, blocks: toBlocks(diffSequences(ids(pa), ids(pb)), pa.lines.length, pb.lines.length) }
    }
  }
  return { a, b, blocks, patch, inlineA, inlineB, added, removed, notes }
}

/** Lines the way patch reads them: LF ends a line; a CR before it is content. */
export function splitOnLf(text: string): PatchSide {
  if (text === '') return { lines: [], noEol: false }
  const lines = text.split('\n')
  const noEol = lines[lines.length - 1] !== ''
  if (!noEol) lines.pop()
  return { lines, noEol }
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

/** A number literal that a double cannot hold exactly, in normalised decimal form. */
class RawNumber {
  constructor(readonly source: string) {}
}

const NUMBER = /^(-)?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/

/**
 * A JSON number literal's exact decimal value, printed the way JavaScript
 * prints numbers (plain up to 1e21, else d.ddde±x). Spellings of the same
 * value print the same — 1.0, 1 and 1e0 are all "1" — and different values
 * never do, however close.
 */
export function normalizeNumber(source: string): string | null {
  const match = NUMBER.exec(source)
  if (!match) return null
  const [, sign = '', int, frac = '', exp = '0'] = match
  let digits = int + frac
  let point = int.length + Number(exp) // value = 0.<digits> × 10^point
  const lead = digits.length - digits.replace(/^0+/, '').length
  digits = digits.slice(lead).replace(/0+$/, '')
  point -= lead
  if (!digits) return '0' // -0 and 0 are the same number, as JSON.stringify says
  const n = digits.length
  let body: string
  if (point > 0 && point <= 21) body = point >= n ? digits + '0'.repeat(point - n) : `${digits.slice(0, point)}.${digits.slice(point)}`
  else if (point <= 0 && point > -6) body = `0.${'0'.repeat(-point)}${digits}`
  else body = `${digits[0]}${n > 1 ? `.${digits.slice(1)}` : ''}e${point - 1 >= 0 ? '+' : ''}${point - 1}`
  return sign + body
}

/**
 * Parses JSON and re-prints it with sorted keys and two-space indent, so key
 * order and formatting stop mattering. Where the browser exposes each
 * literal's source (JSON.parse source text access), a number compares by the
 * value it spells, not by the double it rounds to: 9007199254740993 and …992,
 * 0.1 and 0.10000000000000000555, 1e400 and null all differ. Numbers that are
 * equal as values — 1.0 and 1, 0.10 and 0.1 — compare equal.
 */
export function canonicalJson(text: string, label: string): { text: string; duplicates: boolean } | DiffError {
  if (!text.trim()) return { text: '', duplicates: false }
  let value: unknown
  try {
    value = JSON.parse(text, (_key, v, context?: { source?: string }) => {
      if (typeof v !== 'number' || !context?.source) return v
      const exact = normalizeNumber(context.source)
      if (exact === null || (Number.isFinite(v) && exact === String(v === 0 ? 0 : v))) return v
      return new RawNumber(exact)
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

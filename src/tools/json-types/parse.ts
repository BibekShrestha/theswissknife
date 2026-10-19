/**
 * Input → JSON values. Accepts one document, JSON Lines, or several documents
 * one after another (pretty-printed ones included): `splitDocuments` finds
 * where each top-level value ends, then each is read with JSON.parse.
 *
 * JSON.parse turns every number into a double, so `1.0` reads as an integer
 * and 9007199254740993 loses its last digit. Where the engine passes the
 * literal's source text to the reviver (JSON.parse source text access), a
 * float literal with an integer value becomes FLOAT_LITERAL and an integer
 * literal past 2^53 a BigLiteral, so inference can tell them apart.
 */

export interface Doc {
  /** Offset of the document in the input. */
  start: number
  /** 1-based line of `start`. */
  line: number
  text: string
}

export class BigLiteral {
  constructor(readonly source: string) {}
}

/** Stands in for a number written as a float (`1.0`, `2e3`) whose value happens to be an integer. */
export const FLOAT_LITERAL: { readonly floatLiteral: true } = Object.freeze({ floatLiteral: true as const })

const isSpace = (code: number) => code === 32 || code === 9 || code === 10 || code === 13

function skipString(text: string, from: number): number {
  for (let i = from + 1; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code === 92) i++
    else if (code === 34) return i + 1
  }
  return text.length
}

function countLines(text: string, from: number, to: number): number {
  let lines = 0
  for (let i = from; i < to; i++) if (text.charCodeAt(i) === 10) lines++
  return lines
}

/**
 * Cuts the input at the end of each top-level value. Brackets are counted
 * outside strings only; anything malformed still becomes a document, so
 * JSON.parse reports the error with its position.
 */
export function splitDocuments(text: string): Doc[] {
  const docs: Doc[] = []
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0
  let line = 1
  while (i < text.length) {
    const code = text.charCodeAt(i)
    if (isSpace(code)) {
      if (code === 10) line++
      i++
      continue
    }
    const start = i
    if (code === 123 || code === 91) {
      let depth = 0
      for (; i < text.length; i++) {
        const c = text.charCodeAt(i)
        if (c === 34) i = skipString(text, i) - 1
        else if (c === 123 || c === 91) depth++
        else if (c === 125 || c === 93) {
          if (--depth === 0) {
            i++
            break
          }
        }
      }
    } else if (code === 34) {
      i = skipString(text, i)
    } else {
      // A scalar runs to the next space or structural character; a stray `}` or `,` is a document of its own.
      while (i < text.length) {
        const c = text.charCodeAt(i)
        if (isSpace(c) || c === 123 || c === 91 || c === 125 || c === 93 || c === 34 || c === 44) break
        i++
      }
      if (i === start) i++
    }
    docs.push({ start, line, text: text.slice(start, i) })
    line += countLines(text, start, i)
  }
  return docs
}

let sourceTextSupport: boolean | undefined

/** Feature test: does this engine hand the reviver `{ source }` for primitives? */
export function hasSourceText(): boolean {
  if (sourceTextSupport === undefined) {
    let seen = false
    JSON.parse('[1]', (_key, value, context?: { source?: unknown }) => {
      if (typeof value === 'number') seen = typeof context?.source === 'string'
      return value
    })
    sourceTextSupport = seen
  }
  return sourceTextSupport
}

/** For tests: pretend the engine lacks source text access (or restore detection). */
export function setSourceTextSupport(value: boolean | undefined) {
  sourceTextSupport = value
}

function reviver(_key: string, value: unknown, context?: { source?: string }): unknown {
  if (typeof value !== 'number') return value
  const source = context?.source
  if (source === undefined) return value
  if (/[.eE]/.test(source)) return Number.isInteger(value) ? FLOAT_LITERAL : value
  if (!Number.isSafeInteger(value)) return new BigLiteral(source)
  return value
}

/**
 * Only a number literal of 16+ digits can be past 2^53, and only one with a
 * fraction or exponent can be a float with an integer value — without either
 * in the text a plain JSON.parse is exact, and twice as fast.
 */
const NEEDS_SOURCE = /\d{16}|\d\.\d*0(?!\d)|\d[eE]/

export interface ParsedDoc {
  value: unknown
  /** Numbers were read without their source text (unsupported, or the reviver ran out of stack). */
  approximate: boolean
}

export function parseDoc(text: string): ParsedDoc {
  if (!NEEDS_SOURCE.test(text)) return { value: JSON.parse(text), approximate: false }
  if (!hasSourceText()) return { value: JSON.parse(text), approximate: true }
  try {
    return { value: JSON.parse(text, reviver as (key: string, value: unknown) => unknown), approximate: false }
  } catch (error) {
    // The reviver walk recurses; a deeply nested document can exhaust the stack where a plain parse does not.
    if (error instanceof RangeError) return { value: JSON.parse(text), approximate: true }
    throw error
  }
}

export interface ParseError {
  message: string
  /** Which document (1-based) failed. */
  sample: number
  line?: number
  column?: number
}

function positionOf(text: string, offset: number) {
  let line = 1
  let lineStart = 0
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++
      lineStart = i + 1
    }
  }
  return { line, column: offset - lineStart + 1 }
}

/** Turns an engine's JSON.parse message into a position in the whole input (V8 gives an offset, Firefox a line and column). */
export function describeError(input: string, doc: Doc, sample: number, error: unknown): ParseError {
  const raw = error instanceof Error ? error.message : String(error)
  const message = raw.replace(/^JSON\.parse: /, '')
  if (doc.text === ',') {
    return { message: 'A comma between documents — wrap them in [ ] to make one array, or put one per line (JSON Lines).', sample, ...positionOf(input, doc.start) }
  }
  const offset = /position (\d+)/.exec(raw)
  if (offset) return { message, sample, ...positionOf(input, doc.start + Number(offset[1])) }
  const lineColumn = /line (\d+) column (\d+)/.exec(raw)
  if (lineColumn) {
    const local = Number(lineColumn[1])
    const docStart = positionOf(input, doc.start)
    return { message, sample, line: docStart.line + local - 1, column: local === 1 ? docStart.column + Number(lineColumn[2]) - 1 : Number(lineColumn[2]) }
  }
  return { message, sample, ...positionOf(input, doc.start) }
}

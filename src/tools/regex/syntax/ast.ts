/**
 * The tree the hand-written parser (parser.ts) builds from an ECMAScript 2025
 * pattern. Every node carries its [start, end) span in the pattern source, in
 * UTF-16 code units, so the explanation can quote the text it describes.
 */

export interface Span {
  start: number
  end: number
}

export type Node =
  | Disjunction
  | Sequence
  | Group
  | Quantifier
  | Char
  | Dot
  | Anchor
  | ClassEscape
  | Property
  | CharClass
  | Backreference

export interface Disjunction extends Span {
  type: 'disjunction'
  alternatives: Sequence[]
}

export interface Sequence extends Span {
  type: 'sequence'
  items: Node[]
}

export type GroupKind =
  | 'capture'
  | 'noncapture'
  | 'lookahead'
  | 'negative-lookahead'
  | 'lookbehind'
  | 'negative-lookbehind'
  | 'modifiers'

export interface Group extends Span {
  type: 'group'
  kind: GroupKind
  /** Capture number, for kind 'capture'. */
  index?: number
  name?: string
  /** Flags a modifiers group turns on / off: subsets of "ims". */
  add?: string
  remove?: string
  body: Disjunction
}

export interface Quantifier extends Span {
  type: 'quantifier'
  min: number
  /** Infinity when unbounded. */
  max: number
  lazy: boolean
  body: Node
}

/** How a single character was written. */
export type CharForm = 'literal' | 'escape' | 'control' | 'hex' | 'unicode' | 'octal' | 'identity' | 'null' | 'backspace'

export interface Char extends Span {
  type: 'char'
  /** Code point (u/v mode) or UTF-16 code unit (otherwise). */
  value: number
  form: CharForm
}

export interface Dot extends Span {
  type: 'dot'
}

export interface Anchor extends Span {
  type: 'anchor'
  kind: 'start' | 'end' | 'word-boundary' | 'not-word-boundary'
}

export interface ClassEscape extends Span {
  type: 'class-escape'
  kind: 'd' | 'D' | 's' | 'S' | 'w' | 'W'
}

export interface Property extends Span {
  type: 'property'
  negated: boolean
  /** e.g. "General_Category", "Script", or undefined for a lone name/value. */
  name?: string
  value: string
  /** A property of strings (v flag only), e.g. RGI_Emoji. */
  strings: boolean
}

export interface ClassRange extends Span {
  type: 'range'
  from: Char
  to: Char
}

export interface StringDisjunction extends Span {
  type: 'strings'
  /** The alternatives of \q{…}, as text. */
  strings: string[]
}

export type ClassItem = Char | ClassRange | ClassEscape | Property | CharClass | StringDisjunction

export interface CharClass extends Span {
  type: 'class'
  negated: boolean
  /** Union for plain classes; the v flag adds intersection (&&) and subtraction (--). */
  op: 'union' | 'intersection' | 'subtraction'
  items: ClassItem[]
}

export interface Backreference extends Span {
  type: 'backreference'
  /** Numeric reference (\1). */
  index?: number
  /** Named reference (\k<name>). */
  name?: string
}

export interface GroupInfo {
  index: number
  name?: string
  start: number
  end: number
}

export interface ParsedPattern {
  ast: Disjunction
  /** Capturing groups in order of their opening parenthesis. */
  groups: GroupInfo[]
  /** u or v: code points rather than code units. */
  unicodeMode: boolean
  unicodeSets: boolean
}

export interface ParseError {
  message: string
  /** Position in the pattern, in UTF-16 code units. */
  index: number
}

export type ParseResult = { ok: true; pattern: ParsedPattern } | { ok: false; error: ParseError }

import { abbreviation, classify, isTag, lookalike, type CpKind } from './classify'
import { utf8Length, uPlus } from './encode'
import { categoryOf, scriptExtensionsOf, scriptLabel, scriptOf } from './props'

/**
 * One pass over the whole text: grapheme boundaries, counts, and every
 * finding. The grapheme list itself is built a page at a time (page.ts) from
 * the boundaries kept here, so a large paste costs one scan, not one DOM node
 * per character.
 */

export type Severity = 'danger' | 'warn' | 'info'

export type FindingKind =
  | 'bidi'
  | 'tag'
  | 'invisible'
  | 'surrogate'
  | 'mixed'
  | 'lookalike'
  | 'control'
  | 'space'
  | 'bom'
  | 'variation'
  | 'combining'
  | 'special'

export interface Occurrence {
  /** UTF-16 offset into the analysed text. */
  offset: number
  /** Index of the grapheme it is in (for jumping to its page). */
  grapheme: number
  /** The character(s), for a label. Never rendered raw when invisible. */
  cp?: number
  word?: string
  note?: string
}

export interface Finding {
  kind: FindingKind
  severity: Severity
  count: number
  occurrences: Occurrence[]
  /** Text spelled by tag characters (U+E0020–E007E map to ASCII). */
  hidden?: string
  /** Lines that end inside a bidi override or isolate (the Trojan Source shape). */
  unterminated?: number
  bomAtStart?: boolean
  stacked?: number
  orphans?: number
  /** For 'mixed': words that mix only Latin with Han/kana/Hangul/Bopomofo (normal in CJK text). */
  cjkOnly?: number
  sub?: Partial<Record<CpKind, number>>
}

export interface Stats {
  codeUnits: number
  codePoints: number
  graphemes: number
  /** As TextEncoder would write it (a lone surrogate becomes 3 bytes of U+FFFD). */
  utf8Bytes: number
  lines: number
  nonAscii: number
}

/** Context flags on single code points, keyed by UTF-16 offset. */
export type ContextFlag = 'lookalike' | 'mixed'

export interface Analysis {
  text: string
  /** Grapheme start offsets, plus text.length at the end. */
  bounds: Uint32Array
  stats: Stats
  findings: Finding[]
  context: Map<number, ContextFlag[]>
  /** The Latin letter a flagged look-alike passes for, keyed by offset. */
  looksLike: Map<number, string>
}

export const OCCURRENCE_CAP = 100
export const HIDDEN_CAP = 2000
/** More combining marks than this on one base is "stacked" (Zalgo text). */
export const STACK_LIMIT = 4

const SEVERITY_RANK: Record<Severity, number> = { danger: 0, warn: 1, info: 2 }
const KIND_ORDER: FindingKind[] = ['bidi', 'tag', 'invisible', 'surrogate', 'mixed', 'lookalike', 'control', 'space', 'bom', 'variation', 'combining', 'special']

const segmenter = () => new Intl.Segmenter(undefined, { granularity: 'grapheme' })

let rgiEmoji: RegExp | null | undefined
/** Whole grapheme is a recommended emoji sequence — its ZWJs, VS16 and tags are doing their job. */
export function isEmojiSequence(grapheme: string): boolean {
  if (rgiEmoji === undefined) {
    try {
      rgiEmoji = new RegExp('^\\p{RGI_Emoji}$', 'v')
    } catch {
      rgiEmoji = null
    }
  }
  if (rgiEmoji) return rgiEmoji.test(grapheme)
  // Engines without the v flag: an emoji base followed by the usual joiners.
  return /^\p{Extended_Pictographic}(?:[\u200D\uFE0E\uFE0F\u20E3\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]|\p{Extended_Pictographic})*$/u.test(grapheme)
}

/** Code points a valid emoji sequence uses legitimately. */
export const emojiPart = (cp: number) => cp === 0x200d || cp === 0xfe0e || cp === 0xfe0f || cp === 0x20e3 || isTag(cp)

const isMarkCategory = (gc: string) => gc === 'Mn' || gc === 'Me' || gc === 'Mc'

/** CJK scripts that UTS #39 lets mix with each other and with Latin ("highly restrictive"). */
const CJK = new Set(['Han', 'Hiragana', 'Katakana', 'Hangul', 'Bopomofo'])
/** UTS #39 §5.1 augmented script sets: Han is also Japanese, Korean and Han-with-Bopomofo. */
const AUGMENT: Record<string, string[]> = {
  Han: ['Han', 'Jpan', 'Kore', 'Hanb'],
  Hiragana: ['Hiragana', 'Jpan'],
  Katakana: ['Katakana', 'Jpan'],
  Hangul: ['Hangul', 'Kore'],
  Bopomofo: ['Bopomofo', 'Hanb'],
}

function resolvedScripts(sets: string[][]): Set<string> | null {
  let resolved: Set<string> | null = null
  for (const scx of sets) {
    const augmented = new Set<string>(scx.flatMap((s) => AUGMENT[s] ?? [s]))
    const previous: Set<string> | null = resolved
    const next: Set<string> = previous ? new Set([...previous].filter((s) => augmented.has(s))) : augmented
    if (next.size === 0) return next
    resolved = next
  }
  return resolved
}

const NEUTRAL = new Set(['Common', 'Inherited', 'Unknown'])

class Builder {
  findings = new Map<FindingKind, Finding>()

  get(kind: FindingKind, severity: Severity): Finding {
    let f = this.findings.get(kind)
    if (!f) {
      f = { kind, severity, count: 0, occurrences: [] }
      this.findings.set(kind, f)
    } else if (SEVERITY_RANK[severity] < SEVERITY_RANK[f.severity]) {
      f.severity = severity
    }
    return f
  }

  add(kind: FindingKind, severity: Severity, occurrence: Occurrence) {
    const f = this.get(kind, severity)
    f.count++
    if (f.occurrences.length < OCCURRENCE_CAP) f.occurrences.push(occurrence)
    return f
  }

  list(): Finding[] {
    return [...this.findings.values()].sort(
      (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
    )
  }
}

const KIND_SEVERITY: Record<CpKind, [FindingKind, Severity]> = {
  bidi: ['bidi', 'danger'],
  tag: ['tag', 'danger'],
  invisible: ['invisible', 'danger'],
  surrogate: ['surrogate', 'danger'],
  control: ['control', 'warn'],
  space: ['space', 'warn'],
  bom: ['bom', 'warn'],
  variation: ['variation', 'info'],
  combining: ['combining', 'info'],
  private: ['special', 'info'],
  unassigned: ['special', 'info'],
  noncharacter: ['special', 'warn'],
}

/** Binary search: the grapheme containing UTF-16 offset `offset`. */
export function graphemeAt(bounds: Uint32Array, offset: number): number {
  let lo = 0
  let hi = bounds.length - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (bounds[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return Math.max(0, lo)
}

export function analyze(text: string): Analysis {
  const builder = new Builder()
  const context = new Map<number, ContextFlag[]>()
  const looksLike = new Map<number, string>()
  let bounds = new Uint32Array(Math.min(text.length, 1 << 16) + 1)
  let graphemes = 0
  let codePoints = 0
  let utf8Bytes = 0
  let nonAscii = 0
  let hidden = ''

  const pushBound = (offset: number) => {
    if (graphemes >= bounds.length) {
      const grown = new Uint32Array(bounds.length * 2)
      grown.set(bounds)
      bounds = grown
    }
    bounds[graphemes] = offset
  }

  for (const { segment, index } of segmenter().segment(text)) {
    pushBound(index)
    const g = graphemes++
    const first = segment.charCodeAt(0)
    if (segment.length === 1 && first < 0x7f && (first >= 0x20 || first === 0x09 || first === 0x0a || first === 0x0d)) {
      codePoints++
      utf8Bytes++
      continue
    }

    let emoji: boolean | undefined
    let marks = 0
    let variations = 0
    let offset = index
    let position = 0
    for (const ch of segment) {
      const cp = ch.codePointAt(0)!
      codePoints++
      utf8Bytes += utf8Length(cp)
      if (cp >= 0x80) nonAscii++
      const gc = categoryOf(cp)
      const kind = classify(cp, gc)
      if (position === 0 && isMarkCategory(gc) && kind !== 'variation') {
        // A mark with nothing to sit on: start of text, or after a control.
        const f = builder.add('combining', 'warn', { offset, grapheme: g, cp, note: 'orphan' })
        f.orphans = (f.orphans ?? 0) + 1
      }
      if (kind) {
        if (emojiPart(cp) && (emoji ??= isEmojiSequence(segment))) {
          // Part of a recommended emoji sequence — not a finding.
        } else if (kind === 'combining') {
          marks++
          if (position > 0) builder.add('combining', 'info', { offset, grapheme: g, cp })
        } else {
          if (kind === 'variation') variations++
          const [findingKind, severity] = KIND_SEVERITY[kind]
          const severityHere = kind === 'bom' && offset === 0 ? 'info' : severity
          const f = builder.add(findingKind, severityHere, { offset, grapheme: g, cp })
          if (findingKind === 'special') (f.sub ??= {})[kind] = (f.sub[kind] ?? 0) + 1
          if (kind === 'bom' && offset === 0) f.bomAtStart = true
          if (kind === 'tag' && cp >= 0xe0020 && cp <= 0xe007e && hidden.length < HIDDEN_CAP) hidden += String.fromCharCode(cp - 0xe0000)
        }
      }
      offset += ch.length
      position++
    }
    if (marks > STACK_LIMIT) {
      const f = builder.get('combining', 'warn')
      f.stacked = (f.stacked ?? 0) + 1
      if (f.occurrences.length < OCCURRENCE_CAP) f.occurrences.push({ offset: index, grapheme: g, note: `${marks} marks stacked` })
    }
    if (variations > 1) {
      const f = builder.get('variation', 'warn')
      f.stacked = (f.stacked ?? 0) + 1
    }
  }
  pushBound(text.length)
  bounds = bounds.slice(0, graphemes + 1)

  const tags = builder.findings.get('tag')
  if (tags && hidden) tags.hidden = hidden

  scanBidi(text, bounds, builder)
  scanWords(text, bounds, builder, context, looksLike)

  let lines = text.length ? 1 : 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 0x0a || (c === 0x0d && text.charCodeAt(i + 1) !== 0x0a) || c === 0x2028 || c === 0x2029 || c === 0x85) lines++
  }

  return {
    text,
    bounds,
    stats: { codeUnits: text.length, codePoints, graphemes, utf8Bytes, lines, nonAscii },
    findings: builder.list(),
    context,
    looksLike,
  }
}

/**
 * Trojan Source (CVE-2021-42574) hides code behind an override or isolate
 * that is still open at the end of the line, so the line *displays* in a
 * different order than it compiles. Count lines (paragraphs, in bidi terms)
 * that end with one open.
 */
function scanBidi(text: string, bounds: Uint32Array, builder: Builder) {
  const bidi = builder.findings.get('bidi')
  if (!bidi) return
  const stack: ('embed' | 'isolate')[] = []
  let unterminated = 0
  let opener = -1
  const closeParagraph = () => {
    if (stack.length) {
      unterminated++
      if (bidi.occurrences.length < OCCURRENCE_CAP) bidi.occurrences.unshift({ offset: opener, grapheme: graphemeAt(bounds, opener), cp: text.codePointAt(opener), note: 'unterminated' })
    }
    stack.length = 0
    opener = -1
  }
  const re = /[\u202A-\u202E\u2066-\u2069\n\r\u0085\u2029\u001C-\u001E]/g
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const c = m[0].charCodeAt(0)
    if (c >= 0x202a && c <= 0x202e && c !== 0x202c) {
      if (!stack.length) opener = m.index
      stack.push('embed')
    } else if (c >= 0x2066 && c <= 0x2068) {
      if (!stack.length) opener = m.index
      stack.push('isolate')
    } else if (c === 0x202c) {
      if (stack[stack.length - 1] === 'embed') stack.pop()
    } else if (c === 0x2069) {
      const at = stack.lastIndexOf('isolate')
      if (at >= 0) stack.length = at
    } else {
      closeParagraph()
    }
  }
  closeParagraph()
  bidi.unterminated = unterminated
  if (bidi.occurrences.length > OCCURRENCE_CAP) bidi.occurrences.length = OCCURRENCE_CAP
}

function flag(context: Map<number, ContextFlag[]>, offset: number, value: ContextFlag) {
  const flags = context.get(offset)
  if (!flags) context.set(offset, [value])
  else if (!flags.includes(value)) flags.push(value)
}

const WORD = /[\p{L}\p{M}\p{N}\p{Pc}\u200C\u200D]+/gu
const ASCII_WORD_CHAR = /[A-Za-z0-9]/
const NON_ASCII = /[^\x00-\x7F]/

const clip = (word: string) => (word.length > 60 ? `${word.slice(0, 57)}…` : word)

/**
 * Words (runs of letters, marks, digits and joiners) that mix scripts, and
 * letters that pass for Latin ones. A run's script is the intersection of its
 * letters' Script_Extensions, with UTS #39's augmentation so Japanese and
 * Korean text resolve to one script; an empty intersection is mixed.
 */
function scanWords(text: string, bounds: Uint32Array, builder: Builder, context: Map<number, ContextFlag[]>, looksLike: Map<number, string>) {
  WORD.lastIndex = 0
  for (let m = WORD.exec(text); m; m = WORD.exec(text)) {
    const word = m[0]
    if (!NON_ASCII.test(word)) continue
    const start = m.index
    const sets: string[][] = []
    const counts = new Map<string, number>()
    const chars: { offset: number, cp: number, sc: string, letter: boolean }[] = []
    const hasAscii = ASCII_WORD_CHAR.test(word)
    let offset = start
    for (const ch of word) {
      const cp = ch.codePointAt(0)!
      const sc = scriptOf(cp)
      if (!NEUTRAL.has(sc)) counts.set(sc, (counts.get(sc) ?? 0) + 1)
      chars.push({ offset, cp, sc, letter: categoryOf(cp)[0] === 'L' })
      const scx = scriptExtensionsOf(cp).filter((s) => !NEUTRAL.has(s))
      if (scx.length) sets.push(scx)
      offset += ch.length
    }

    const resolved = resolvedScripts(sets)
    if (resolved && resolved.size === 0) {
      const scripts = [...counts.keys()]
      const nonLatin = scripts.filter((s) => s !== 'Latin')
      const cjkOnly = nonLatin.every((s) => CJK.has(s)) && (resolvedScripts(sets.filter((set) => !set.includes('Latin')))?.size ?? 1) > 0
      const majority = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      const label = scripts.map(scriptLabel).join(' + ')
      const f = builder.add('mixed', cjkOnly ? 'info' : 'danger', { offset: start, grapheme: graphemeAt(bounds, start), word: clip(word), note: label })
      if (cjkOnly) f.cjkOnly = (f.cjkOnly ?? 0) + 1
      if (!cjkOnly) {
        for (const c of chars) if (!NEUTRAL.has(c.sc) && c.sc !== majority) flag(context, c.offset, 'mixed')
      }
    }

    // Look-alikes: inside a word that also has ASCII letters, or a word made
    // only of them (three letters or more), or any compatibility form.
    const found = chars.map((c) => ({ ...c, like: lookalike(c.cp) }))
    const letters = found.filter((c) => c.letter)
    const whole = !hasAscii && letters.length >= 3 && letters.every((c) => c.like?.source === 'list')
    for (const c of found) {
      if (!c.like) continue
      if (!(hasAscii || whole || c.like.source === 'nfkc')) continue
      flag(context, c.offset, 'lookalike')
      looksLike.set(c.offset, c.like.latin)
      builder.add('lookalike', hasAscii ? 'danger' : 'warn', {
        offset: c.offset,
        grapheme: graphemeAt(bounds, c.offset),
        cp: c.cp,
        word: clip(word),
        note: whole ? `the whole word reads as “${clip(spellLatin(word))}”` : `looks like “${c.like.latin}”`,
      })
    }
  }
}

/** The word with every look-alike swapped for the Latin letter it imitates. */
export function spellLatin(word: string): string {
  let out = ''
  for (const ch of word) out += lookalike(ch.codePointAt(0)!)?.latin ?? ch
  return out
}

/** `U+200B ZWSP` — the label used wherever a character can't be shown as itself. */
export function cpLabel(cp: number): string {
  const abbr = abbreviation(cp)
  return abbr ? `${uPlus(cp)} ${abbr}` : uPlus(cp)
}

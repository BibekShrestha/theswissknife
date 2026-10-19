import { emojiPart, isEmojiSequence, type Analysis, type ContextFlag } from './analyze'
import { abbreviation, classify, type CpKind } from './classify'
import { codePoints, uPlus } from './encode'
import { categoryOf, scriptOf } from './props'

/**
 * What the worker sends for display: one page of graphemes, a normalisation
 * view, the cleaned outputs. All built from an Analysis, never the DOM.
 */

export type NameLookup = (cp: number) => { name: string, kind: 'name' | 'alias' } | null

export const PAGE_SIZE = 200
/** Code points listed per grapheme; a Zalgo cluster can hold thousands. */
export const CP_CAP = 16

export type CpFlag = CpKind | ContextFlag | 'emoji'

export interface CpView {
  cp: number
  name: string | null
  alias: boolean
  gc: string
  script: string
  flags: CpFlag[]
}

export interface GraphemeView {
  index: number
  offset: number
  text: string
  cps: CpView[]
  /** Code points beyond CP_CAP, not listed. */
  more: number
  emoji: boolean
}

export interface Page {
  index: number
  start: number
  total: number
  pages: number
  graphemes: GraphemeView[]
}

export function buildPage(analysis: Analysis, pageIndex: number, names: NameLookup | null): Page {
  const total = analysis.stats.graphemes
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const index = Math.min(Math.max(0, pageIndex), pages - 1)
  const start = index * PAGE_SIZE
  const end = Math.min(total, start + PAGE_SIZE)
  const graphemes: GraphemeView[] = []
  for (let g = start; g < end; g++) {
    const offset = analysis.bounds[g]
    const text = analysis.text.slice(offset, analysis.bounds[g + 1])
    const all = codePoints(text)
    const emoji = all.length > 1 && all.some(emojiPart) && isEmojiSequence(text)
    const cps: CpView[] = []
    let at = offset
    for (const cp of all.slice(0, CP_CAP)) {
      const gc = categoryOf(cp)
      const kind = classify(cp, gc)
      const flags: CpFlag[] = []
      if (kind) flags.push(emoji && emojiPart(cp) ? 'emoji' : kind)
      flags.push(...(analysis.context.get(at) ?? []))
      const name = names?.(cp) ?? null
      cps.push({ cp, name: name?.name ?? null, alias: name?.kind === 'alias', gc, script: scriptOf(cp), flags })
      at += cp > 0xffff ? 2 : 1
    }
    graphemes.push({ index: g, offset, text, cps, more: Math.max(0, all.length - CP_CAP), emoji })
  }
  return { index, start, total, pages, graphemes }
}

export type Form = 'NFC' | 'NFD' | 'NFKC' | 'NFKD'
export const FORMS: readonly Form[] = ['NFC', 'NFD', 'NFKC', 'NFKD']
export const CHANGE_CAP = 200

export interface Change {
  grapheme: number
  offset: number
  before: string
  after: string
}

export interface NormalizeView {
  form: Form
  output: string
  /** Graphemes the form changes. */
  changed: number
  changes: Change[]
  codePointsBefore: number
  codePointsAfter: number
  /** Which forms leave the text as it is. */
  unchanged: Record<Form, boolean>
  /**
   * The per-grapheme list is an explanation; the output is the whole text
   * normalised at once. They differ only when a change crosses a grapheme
   * boundary, which the view then says.
   */
  crossesGraphemes: boolean
}

const ASCII_ONLY = /^[\x00-\x7F]*$/

export function normalizeView(analysis: Analysis, form: Form): NormalizeView {
  const { text, bounds } = analysis
  const output = text.normalize(form)
  const changes: Change[] = []
  let changed = 0
  let joined = ''
  for (let g = 0; g < analysis.stats.graphemes; g++) {
    const before = text.slice(bounds[g], bounds[g + 1])
    if (ASCII_ONLY.test(before)) {
      joined += before
      continue
    }
    const after = before.normalize(form)
    joined += after
    if (after === before) continue
    changed++
    if (changes.length < CHANGE_CAP) changes.push({ grapheme: g, offset: bounds[g], before, after })
  }
  const unchanged = Object.fromEntries(FORMS.map((f) => [f, f === form ? output === text : text.normalize(f) === text])) as Record<Form, boolean>
  return {
    form,
    output,
    changed,
    changes,
    codePointsBefore: analysis.stats.codePoints,
    codePointsAfter: countCodePoints(output),
    unchanged,
    crossesGraphemes: joined !== output,
  }
}

function countCodePoints(text: string): number {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = text.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) i++
    }
    n++
  }
  return n
}

export interface CleanOptions {
  /** Leave ZWJ, VS15/16, keycaps and tags alone inside recommended emoji sequences. */
  keepEmoji: boolean
  /** Odd spaces become U+0020; line/paragraph separators, NEL, VT and FF become LF. */
  plainSpaces: boolean
}

export interface CleanView {
  stripped: string
  revealed: string
  removed: number
  replaced: number
  revealedCount: number
  byKind: Partial<Record<CpKind, number>>
}

/** What "strip invisibles" removes. Combining marks and look-alike letters are never touched. */
const STRIP: ReadonlySet<CpKind> = new Set(['bidi', 'invisible', 'tag', 'variation', 'bom', 'surrogate', 'control'])
const NEWLINE_SPACES = new Set([0x2028, 0x2029, 0x85, 0x0b, 0x0c])

export function cleanView(analysis: Analysis, options: CleanOptions, names: NameLookup | null): CleanView {
  const { text, bounds } = analysis
  const stripped: string[] = []
  const revealed: string[] = []
  const byKind: Partial<Record<CpKind, number>> = {}
  let removed = 0
  let replaced = 0
  let revealedCount = 0
  let tagRun = ''

  const flushTags = () => {
    if (!tagRun) return
    revealed.push(`[TAGS “${tagRun}”]`)
    tagRun = ''
  }
  const marker = (cp: number) => {
    const abbr = abbreviation(cp)
    const name = abbr ? null : names?.(cp)?.name
    return `[${uPlus(cp)}${abbr ? ` ${abbr}` : name ? ` ${name}` : ''}]`
  }

  for (let g = 0; g < analysis.stats.graphemes; g++) {
    const segment = text.slice(bounds[g], bounds[g + 1])
    if (ASCII_PRINTABLE.test(segment)) {
      flushTags()
      stripped.push(segment)
      revealed.push(segment)
      continue
    }
    let emoji: boolean | undefined
    let offset = bounds[g]
    for (const ch of segment) {
      const cp = ch.codePointAt(0)!
      const at = offset
      offset += ch.length
      const kind = classify(cp)
      const keep = kind !== null && emojiPart(cp) && options.keepEmoji && (emoji ??= isEmojiSequence(segment))
      if (kind === 'tag' && !keep) {
        byKind.tag = (byKind.tag ?? 0) + 1
        removed++
        revealedCount++
        if (cp >= 0xe0020 && cp <= 0xe007e) tagRun += String.fromCharCode(cp - 0xe0000)
        else {
          flushTags()
          revealed.push(marker(cp))
        }
        continue
      }
      flushTags()
      if (!kind || keep) {
        stripped.push(ch)
        if (analysis.context.get(at)?.includes('lookalike')) {
          revealed.push(`[${uPlus(cp)} looks like “${analysis.looksLike.get(at) ?? '?'}”]`)
          revealedCount++
        } else {
          revealed.push(ch)
        }
        continue
      }
      if (kind === 'space') {
        revealedCount++
        const newline = NEWLINE_SPACES.has(cp)
        revealed.push(marker(cp) + (newline ? '\n' : ''))
        if (options.plainSpaces) {
          stripped.push(newline ? '\n' : ' ')
          replaced++
          byKind.space = (byKind.space ?? 0) + 1
        } else {
          stripped.push(ch)
        }
        continue
      }
      if (STRIP.has(kind)) {
        byKind[kind] = (byKind[kind] ?? 0) + 1
        removed++
        revealedCount++
        revealed.push(marker(cp))
        continue
      }
      // combining, private use, noncharacter, unassigned: kept as they are.
      stripped.push(ch)
      revealed.push(ch)
    }
  }
  flushTags()
  return { stripped: stripped.join(''), revealed: revealed.join(''), removed, replaced, revealedCount, byKind }
}

const ASCII_PRINTABLE = /^[\x20-\x7E\t\n\r]+$/

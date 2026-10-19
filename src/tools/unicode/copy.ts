import type { Finding, FindingKind } from './lib/analyze'
import { abbreviation, classify, HIDDEN_KINDS } from './lib/classify'
import type { CpFlag } from './lib/views'
import { escapeString, uPlus } from './lib/encode'

/** What each finding means, in the words the panel shows. */
export const FINDING_TITLES: Record<FindingKind, string> = {
  bidi: 'Bidirectional controls',
  tag: 'Tag characters',
  invisible: 'Invisible characters',
  surrogate: 'Lone surrogates',
  mixed: 'Mixed scripts in one word',
  lookalike: 'Look-alike letters',
  control: 'Control characters',
  space: 'Unusual spaces',
  bom: 'Byte order mark',
  variation: 'Variation selectors',
  combining: 'Combining marks',
  special: 'Private-use, noncharacter or unassigned',
}

export function findingDetail(f: Finding): string[] {
  const n = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`
  switch (f.kind) {
    case 'bidi':
      return [
        'They change the order text is displayed in without changing what it is: the Trojan Source trick (CVE-2021-42574) uses them to make code read differently from how it runs.',
        ...(f.unterminated ? [`${n(f.unterminated, 'line')} ${f.unterminated === 1 ? 'ends' : 'end'} with an override or isolate still open.`] : []),
      ]
    case 'tag':
      return ['Invisible copies of ASCII. Outside emoji flags they are a known way to hide instructions in text, for example in prompts for AI tools.']
    case 'invisible':
      return ['Zero-width spaces and joiners, word joiners, soft hyphens, Hangul fillers and other format characters draw nothing, but they break search, comparison and identifiers. ZWJ and ZWNJ do belong inside Indic and Arabic-script words, and inside emoji, where they are not flagged.']
    case 'surrogate':
      return ['Half of a UTF-16 pair on its own, which is not valid Unicode. UTF-8 cannot encode it, so TextEncoder, fetch bodies and most files get U+FFFD in its place.']
    case 'mixed':
      return [
        'Letters from different scripts in one word are the classic homograph trick, such as a Cyrillic а in a Latin word. Shared characters (digits, marks, punctuation) don’t count, and Japanese or Korean text that combines Han with kana or Hangul resolves to one script (UTS #39).',
        ...(f.cjkOnly ? [`${n(f.cjkOnly, 'word')} only ${f.cjkOnly === 1 ? 'mixes' : 'mix'} Latin with Han, kana, Hangul or Bopomofo, which is normal in CJK text.`] : []),
      ]
    case 'lookalike':
      return ['Letters that pass for Latin ones, flagged in words that also contain ASCII letters or that are made only of look-alikes, plus compatibility forms (fullwidth, mathematical, ligatures) that NFKC folds to ASCII. The look-alike list is short and hand-picked (Cyrillic, Greek, Armenian, Cherokee), not the full Unicode confusables table.']
    case 'control':
      return ['C0 and C1 control characters other than tab, line feed and carriage return. Terminals act on some of them: ESC starts an escape sequence.']
    case 'space':
      return ['Non-breaking, thin, ideographic and other spaces, line and paragraph separators, NEL, vertical tab, form feed and the blank braille pattern. They look like a space but don’t compare equal to one.']
    case 'bom':
      return f.bomAtStart && f.count === 1
        ? ['U+FEFF at the very start is a byte order mark. Most readers skip it, but it breaks shebang lines, some JSON parsers and the first CSV header.']
        : ['U+FEFF inside text is a zero-width no-break space, usually left over from joining files that each started with a byte order mark.']
    case 'variation':
      return [
        'They pick a glyph variant: emoji or text style, or a CJK ideograph variant. Outside emoji they are often stray, and several on one character can carry hidden data.',
        ...(f.stacked ? [`${n(f.stacked, 'character')} ${f.stacked === 1 ? 'has' : 'have'} more than one.`] : []),
      ]
    case 'combining':
      return [
        'Accents and other marks that attach to the character before them, normal in many languages. They are a problem when one has nothing to attach to, or when many stack on one character (Zalgo text).',
        ...(f.orphans ? [`${n(f.orphans, 'mark')} with no base character.`] : []),
        ...(f.stacked ? [`${n(f.stacked, 'character')} with more than 4 marks.`] : []),
      ]
    case 'special': {
      const sub = f.sub ?? {}
      const parts = [
        sub.private && n(sub.private, 'private-use character'),
        sub.noncharacter && n(sub.noncharacter, 'noncharacter'),
        sub.unassigned && n(sub.unassigned, 'unassigned code point'),
      ].filter(Boolean)
      return [
        'Private-use characters mean whatever a font says they mean; noncharacters are reserved for internal use; unassigned ones are unknown to this browser’s Unicode data.',
        parts.join(', ') + '.',
      ]
    }
  }
}

export const FLAG_LABELS: Record<CpFlag, string> = {
  bidi: 'bidi control',
  invisible: 'invisible',
  tag: 'tag character',
  variation: 'variation selector',
  space: 'unusual space',
  bom: 'BOM',
  surrogate: 'lone surrogate',
  control: 'control',
  combining: 'combining',
  private: 'private use',
  noncharacter: 'noncharacter',
  unassigned: 'unassigned',
  lookalike: 'look-alike',
  mixed: 'mixed script',
  emoji: 'part of emoji',
}

/** Flags that make a grapheme worth highlighting in the list. */
export const LOUD_FLAGS: ReadonlySet<CpFlag> = new Set(['bidi', 'invisible', 'tag', 'surrogate', 'lookalike', 'mixed', 'control', 'space', 'bom', 'variation', 'noncharacter'])

/**
 * Text that may hold bidi controls or invisibles, made safe to show: every
 * character that draws nothing (or reorders) becomes a [label]. Used for words
 * and normalisation changes, which come straight from the user's input.
 */
export function visible(text: string): string {
  let out = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    const kind = classify(cp)
    if (kind && HIDDEN_KINDS.has(kind)) out += `[${abbreviation(cp) ?? uPlus(cp)}]`
    else out += ch
  }
  return out
}

/** The whole grapheme as one escape string per language, for the copy buttons. */
export const graphemeEscapes = (text: string) => [
  ['JavaScript', escapeString(text, 'js')],
  ['HTML', escapeString(text, 'html')],
  ['CSS', escapeString(text, 'css')],
] as const

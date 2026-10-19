import { categoryOf } from './props'

/**
 * What a single code point is, before context: the flags that don't depend on
 * its neighbours. Context (emoji sequences, words that mix scripts, stacked
 * marks) is applied by analyze.ts.
 */

export type CpKind =
  | 'bidi'
  | 'invisible'
  | 'tag'
  | 'variation'
  | 'space'
  | 'bom'
  | 'surrogate'
  | 'control'
  | 'combining'
  | 'private'
  | 'noncharacter'
  | 'unassigned'

const BIDI = new Set([0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069])

/** Zero-width or blank-rendering characters that are not spaces or bidi controls. */
const INVISIBLE = new Set([
  0x00ad, // SOFT HYPHEN: shows only where a line breaks
  0x034f, // COMBINING GRAPHEME JOINER
  0x115f, 0x1160, 0x3164, 0xffa0, // Hangul fillers: letters that draw nothing
  0x17b4, 0x17b5, // Khmer inherent vowels
  0x180e, // MONGOLIAN VOWEL SEPARATOR
  0x200b, 0x200c, 0x200d, 0x2060, // ZWSP, ZWNJ, ZWJ, WORD JOINER
  0x2061, 0x2062, 0x2063, 0x2064, // invisible math operators
])

/** Format (Cf) characters that draw a visible mark — Prepended_Concatenation_Mark. */
const VISIBLE_FORMAT = new Set([0x0600, 0x0601, 0x0602, 0x0603, 0x0604, 0x0605, 0x06dd, 0x070f, 0x0890, 0x0891, 0x08e2, 0x110bd, 0x110cd])

/** Odd whitespace: everything that is blank but is not U+0020, TAB, LF or CR. */
const EXTRA_SPACE = new Set([0x000b, 0x000c, 0x0085, 0x2028, 0x2029, 0x2800])

export const isVariationSelector = (cp: number) =>
  (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef) || (cp >= 0x180b && cp <= 0x180d) || cp === 0x180f

export const isTag = (cp: number) => cp >= 0xe0000 && cp <= 0xe007f

export const isNoncharacter = (cp: number) => (cp >= 0xfdd0 && cp <= 0xfdef) || (cp & 0xfffe) === 0xfffe

export function classify(cp: number, gc = categoryOf(cp)): CpKind | null {
  if (cp >= 0x20 && cp < 0x7f) return null
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return null
  if (cp === 0xfeff) return 'bom'
  if (gc === 'Cs') return 'surrogate'
  if (BIDI.has(cp)) return 'bidi'
  if (isTag(cp)) return 'tag'
  if (isVariationSelector(cp)) return 'variation'
  if (EXTRA_SPACE.has(cp) || gc === 'Zs') return 'space'
  if (INVISIBLE.has(cp)) return 'invisible'
  if (gc === 'Cc') return 'control'
  if (gc === 'Cf') return VISIBLE_FORMAT.has(cp) ? null : 'invisible'
  if (gc === 'Mn' || gc === 'Me') return 'combining'
  if (gc === 'Co') return 'private'
  if (gc === 'Cn') return isNoncharacter(cp) ? 'noncharacter' : 'unassigned'
  return null
}

/** Kinds that draw nothing (or reorder text) — shown as labels, never raw. */
export const HIDDEN_KINDS: ReadonlySet<CpKind> = new Set(['bidi', 'invisible', 'tag', 'variation', 'space', 'bom', 'surrogate', 'control'])

const C0 = 'NUL SOH STX ETX EOT ENQ ACK BEL BS HT LF VT FF CR SO SI DLE DC1 DC2 DC3 DC4 NAK SYN ETB CAN EM SUB ESC FS GS RS US'.split(' ')
const C1 = 'PAD HOP BPH NBH IND NEL SSA ESA HTS HTJ VTS PLD PLU RI SS2 SS3 DCS PU1 PU2 STS CCH MW SPA EPA SOS SGC SCI CSI ST OSC PM APC'.split(' ')

const ABBREVIATIONS = new Map<number, string>([
  [0x0020, 'SP'], [0x007f, 'DEL'], [0x00a0, 'NBSP'], [0x00ad, 'SHY'], [0x034f, 'CGJ'], [0x061c, 'ALM'],
  [0x115f, 'HCF'], [0x1160, 'HJF'], [0x1680, 'OSM'], [0x17b4, 'KIVAQ'], [0x17b5, 'KIVAA'], [0x180e, 'MVS'],
  [0x180b, 'FVS1'], [0x180c, 'FVS2'], [0x180d, 'FVS3'], [0x180f, 'FVS4'],
  [0x2000, 'NQSP'], [0x2001, 'MQSP'], [0x2002, 'ENSP'], [0x2003, 'EMSP'], [0x2004, '3/MSP'], [0x2005, '4/MSP'],
  [0x2006, '6/MSP'], [0x2007, 'FSP'], [0x2008, 'PSP'], [0x2009, 'THSP'], [0x200a, 'HSP'],
  [0x200b, 'ZWSP'], [0x200c, 'ZWNJ'], [0x200d, 'ZWJ'], [0x200e, 'LRM'], [0x200f, 'RLM'],
  [0x2028, 'LSEP'], [0x2029, 'PSEP'], [0x202a, 'LRE'], [0x202b, 'RLE'], [0x202c, 'PDF'], [0x202d, 'LRO'], [0x202e, 'RLO'],
  [0x202f, 'NNBSP'], [0x205f, 'MMSP'], [0x2060, 'WJ'], [0x2061, 'FA'], [0x2062, 'IT'], [0x2063, 'IS'], [0x2064, 'IP'],
  [0x2066, 'LRI'], [0x2067, 'RLI'], [0x2068, 'FSI'], [0x2069, 'PDI'], [0x2800, 'BRBL'], [0x3000, 'IDSP'], [0x3164, 'HF'],
  [0xfeff, 'BOM'], [0xffa0, 'HWHF'], [0xfffc, 'OBJ'], [0xfffd, 'REPL'], [0xe0001, 'LANG TAG'], [0xe007f, 'CANCEL TAG'],
])

/** Short label for a character that draws nothing: `ZWSP`, `VS16`, `TAG a`, `LF`. Null if none. */
export function abbreviation(cp: number): string | null {
  if (cp < 0x20) return C0[cp]
  if (cp >= 0x80 && cp < 0xa0) return C1[cp - 0x80]
  const known = ABBREVIATIONS.get(cp)
  if (known) return known
  if (cp >= 0xfe00 && cp <= 0xfe0f) return `VS${cp - 0xfe00 + 1}`
  if (cp >= 0xe0100 && cp <= 0xe01ef) return `VS${cp - 0xe0100 + 17}`
  if (cp >= 0xe0020 && cp <= 0xe007e) return `TAG ${String.fromCharCode(cp - 0xe0000)}`
  return null
}

/**
 * A short, hand-picked list of letters from other scripts that are drawn like
 * a Latin letter in common fonts — the usual homograph suspects (Cyrillic,
 * Greek, Armenian, Cherokee, and a few Latin-script variants). It is not the
 * full Unicode confusables table (UTS #39); compatibility forms such as
 * fullwidth or mathematical letters are caught separately through NFKC.
 */
const LOOKALIKES: Record<string, string> = {
  // Cyrillic
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', ѕ: 's', і: 'i', ј: 'j', ԁ: 'd', ԛ: 'q', ԝ: 'w', һ: 'h', ӏ: 'l', ү: 'y',
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', У: 'Y', Ѕ: 'S', І: 'I', Ј: 'J', Ԛ: 'Q', Ԝ: 'W', Ү: 'Y', Ӏ: 'I',
  // Greek
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X', Ϲ: 'C', Ϳ: 'J',
  ο: 'o', ν: 'v', α: 'a', ι: 'i', κ: 'k', ρ: 'p', υ: 'u', χ: 'x', ϲ: 'c', ϳ: 'j', γ: 'y',
  // Armenian
  օ: 'o', ս: 'u', հ: 'h', ո: 'n', զ: 'q', ց: 'g', Տ: 'S', Օ: 'O', Ս: 'U',
  // Cherokee
  Ꭺ: 'A', Ᏼ: 'B', Ꮯ: 'C', Ꭼ: 'E', Ꮋ: 'H', Ꭻ: 'J', Ꮶ: 'K', Ꮇ: 'M', Ꮲ: 'P', Ꮪ: 'S', Ꭲ: 'T', Ꮃ: 'W', Ꮓ: 'Z',
  // Latin-script variants
  ı: 'i', ɑ: 'a', ɡ: 'g', ɩ: 'i',
}

const ASCII_ALNUM = /^[A-Za-z0-9]{1,3}$/
const NFKC_CANDIDATE = /^[\p{L}\p{Nd}\p{Nl}]$/u

export interface Lookalike {
  latin: string
  /** 'list': on the hand-picked list; 'nfkc': a compatibility form NFKC folds to ASCII (fullwidth, mathematical, ligature). */
  source: 'list' | 'nfkc'
}

/** The ASCII letters this character passes for, if any. */
export function lookalike(cp: number): Lookalike | null {
  if (cp < 0x80) return null
  const ch = String.fromCodePoint(cp)
  const listed = LOOKALIKES[ch]
  if (listed) return { latin: listed, source: 'list' }
  if (!NFKC_CANDIDATE.test(ch)) return null
  const folded = ch.normalize('NFKC')
  return folded !== ch && ASCII_ALNUM.test(folded) ? { latin: folded, source: 'nfkc' } : null
}

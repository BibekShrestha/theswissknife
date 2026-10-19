/**
 * General category and script, straight from the JavaScript engine's own
 * Unicode data via regex property escapes (`\p{gc=…}`, `\p{sc=…}`,
 * `\p{scx=…}`). No table ships for these, so they are as current as the
 * browser — which can differ from the names table's Unicode version.
 *
 * Each lookup is one exec of a combined alternation (one capture group per
 * value) and is cached per code point.
 */

export const CATEGORIES: readonly (readonly [string, string])[] = [
  ['Lu', 'Uppercase letter'], ['Ll', 'Lowercase letter'], ['Lt', 'Titlecase letter'], ['Lm', 'Modifier letter'], ['Lo', 'Other letter'],
  ['Mn', 'Nonspacing mark'], ['Mc', 'Spacing mark'], ['Me', 'Enclosing mark'],
  ['Nd', 'Decimal number'], ['Nl', 'Letter number'], ['No', 'Other number'],
  ['Pc', 'Connector punctuation'], ['Pd', 'Dash punctuation'], ['Ps', 'Open punctuation'], ['Pe', 'Close punctuation'],
  ['Pi', 'Initial punctuation'], ['Pf', 'Final punctuation'], ['Po', 'Other punctuation'],
  ['Sm', 'Math symbol'], ['Sc', 'Currency symbol'], ['Sk', 'Modifier symbol'], ['So', 'Other symbol'],
  ['Zs', 'Space separator'], ['Zl', 'Line separator'], ['Zp', 'Paragraph separator'],
  ['Cc', 'Control'], ['Cf', 'Format'], ['Cs', 'Surrogate'], ['Co', 'Private use'], ['Cn', 'Unassigned'],
]

export const CATEGORY_NAMES: ReadonlyMap<string, string> = new Map(CATEGORIES)

/**
 * Script property values (long names), most common first. Engines reject a
 * name they don't know, so the list is filtered by what this engine compiles;
 * Unicode 16 and 17 scripts simply drop out of an older browser's list.
 */
const SCRIPT_CANDIDATES = `Latin Common Inherited Greek Cyrillic Han Hiragana Katakana Hangul Arabic Hebrew Devanagari Bengali Thai Armenian Georgian Ethiopic
Adlam Ahom Anatolian_Hieroglyphs Avestan Balinese Bamum Bassa_Vah Batak Bhaiksuki Bopomofo Brahmi Braille Buginese Buhid Canadian_Aboriginal
Carian Caucasian_Albanian Chakma Cham Cherokee Chorasmian Coptic Cuneiform Cypriot Cypro_Minoan Deseret Dives_Akuru Dogra Duployan
Egyptian_Hieroglyphs Elbasan Elymaic Glagolitic Gothic Grantha Gujarati Gunjala_Gondi Gurmukhi Hanifi_Rohingya Hanunoo Hatran
Imperial_Aramaic Inscriptional_Pahlavi Inscriptional_Parthian Javanese Kaithi Kannada Kawi Kayah_Li Kharoshthi Khitan_Small_Script Khmer
Khojki Khudawadi Lao Lepcha Limbu Linear_A Linear_B Lisu Lycian Lydian Mahajani Makasar Malayalam Mandaic Manichaean Marchen
Masaram_Gondi Medefaidrin Meetei_Mayek Mende_Kikakui Meroitic_Cursive Meroitic_Hieroglyphs Miao Modi Mongolian Mro Multani Myanmar
Nabataean Nag_Mundari Nandinagari New_Tai_Lue Newa Nko Nushu Nyiakeng_Puachue_Hmong Ogham Ol_Chiki Old_Hungarian Old_Italic
Old_North_Arabian Old_Permic Old_Persian Old_Sogdian Old_South_Arabian Old_Turkic Old_Uyghur Oriya Osage Osmanya Pahawh_Hmong Palmyrene
Pau_Cin_Hau Phags_Pa Phoenician Psalter_Pahlavi Rejang Runic Samaritan Saurashtra Sharada Shavian Siddham SignWriting Sinhala Sogdian
Sora_Sompeng Soyombo Sundanese Syloti_Nagri Syriac Tagalog Tagbanwa Tai_Le Tai_Tham Tai_Viet Takri Tamil Tangsa Tangut Telugu Thaana
Tibetan Tifinagh Tirhuta Toto Ugaritic Vai Vithkuqi Wancho Warang_Citi Yezidi Yi Zanabazar_Square
Garay Gurung_Khema Kirat_Rai Ol_Onal Sunuwar Todhri Tulu_Tigalari
Beria_Erfe Sidetic Tai_Yo Tolong_Siki`.split(/\s+/)

const compiles = (source: string, flags = 'u') => {
  try {
    new RegExp(source, flags)
    return true
  } catch {
    return false
  }
}

export const SCRIPTS: readonly string[] = SCRIPT_CANDIDATES.filter((name) => compiles(`\\p{sc=${name}}`))
const SCX_SCRIPTS: readonly string[] = SCRIPTS.filter((name) => compiles(`\\p{scx=${name}}`))

const alternation = (escapes: readonly string[]) => new RegExp(`^(?:${escapes.map((e) => `(${e})`).join('|')})$`, 'u')

const categoryRe = alternation(CATEGORIES.map(([code]) => `\\p{gc=${code}}`))
const scriptRe = alternation(SCRIPTS.map((name) => `\\p{sc=${name}}`))
const scxRes = SCX_SCRIPTS.map((name) => [name, new RegExp(`^\\p{scx=${name}}$`, 'u')] as const)

const charOf = (cp: number) => (cp >= 0xd800 && cp <= 0xdfff ? String.fromCharCode(cp) : String.fromCodePoint(cp))

function matchedGroup(match: RegExpExecArray | null): number {
  if (!match) return -1
  for (let i = 1; i < match.length; i++) if (match[i] !== undefined) return i - 1
  return -1
}

const categoryCache = new Map<number, string>()
const scriptCache = new Map<number, string>()
const scxCache = new Map<number, readonly string[]>()

/** Two-letter general category code (`Lu`, `Cf`, …). */
export function categoryOf(cp: number): string {
  let gc = categoryCache.get(cp)
  if (gc === undefined) {
    const index = matchedGroup(categoryRe.exec(charOf(cp)))
    gc = index < 0 ? 'Cn' : CATEGORIES[index][0]
    categoryCache.set(cp, gc)
  }
  return gc
}

/** Script long name (`Latin`, `Common`, `Inherited`, or `Unknown`). */
export function scriptOf(cp: number): string {
  let sc = scriptCache.get(cp)
  if (sc === undefined) {
    const index = matchedGroup(scriptRe.exec(charOf(cp)))
    sc = index < 0 ? 'Unknown' : SCRIPTS[index]
    scriptCache.set(cp, sc)
  }
  return sc
}

/** Script_Extensions: every script the character is used with (U+30FC → Hiragana, Katakana). */
export function scriptExtensionsOf(cp: number): readonly string[] {
  let scx = scxCache.get(cp)
  if (scx === undefined) {
    const ch = charOf(cp)
    scx = scxRes.filter(([, re]) => re.test(ch)).map(([name]) => name)
    if (scx.length === 0) scx = [scriptOf(cp)]
    scxCache.set(cp, scx)
  }
  return scx
}

export const scriptLabel = (name: string) => name.replace(/_/g, ' ')

/**
 * What the built-in PDF fonts (Helvetica, which form appearances and text
 * stamps are drawn in) can write: WinAnsi, Windows-1252's characters.
 * Kept free of pdf-lib so Fill & Sign's screen can check text as it is
 * typed; winansi.test.ts holds it equal to pdf-lib's own table.
 *
 * Text outside it would need an embedded font. The site ships no font that
 * covers other scripts, so those characters are refused by name rather
 * than written as missing glyphs.
 */

/** Windows-1252's 0x80–0x9F block, the only characters past Latin-1 it has. */
const EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d,
  0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
])

export function winAnsiCodePoint(cp: number): boolean {
  return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || EXTRA.has(cp)
}

/**
 * The distinct characters of `text` Helvetica cannot write, in order of
 * first appearance. Line breaks count as writable when `multiline`.
 */
export function unencodable(text: string, multiline = false): string[] {
  const bad: string[] = []
  for (const ch of text) {
    if (multiline && (ch === '\n' || ch === '\r')) continue
    if (!winAnsiCodePoint(ch.codePointAt(0)!) && !bad.includes(ch)) bad.push(ch)
  }
  return bad
}

const NAMES: Record<string, string> = { '\t': 'tab', '\n': 'line break', '\r': 'line break' }

/** "“页”, “面” and a tab" — the characters as the person can recognise them. */
export function describeChars(chars: string[]): string {
  const shown = chars.slice(0, 5).map((c) => NAMES[c] ?? (/\p{C}|\p{Z}/u.test(c) ? `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}` : `“${c}”`))
  const more = chars.length > 5 ? ` and ${chars.length - 5} more` : ''
  if (shown.length === 1) return shown[0] + more
  return more ? shown.join(', ') + more : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
}

/** The refusal shown under a field or text box, or '' when everything can be written. */
export function encodingProblem(text: string, multiline = false): string {
  const bad = unencodable(text, multiline)
  if (bad.length === 0) return ''
  return `${describeChars(bad)} can’t be written: the built-in PDF font covers Western European (Windows-1252) characters only, and this tool has no font to embed for other scripts.`
}

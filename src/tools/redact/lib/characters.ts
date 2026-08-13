/**
 * The mask characters, from Unicode's Block Elements range that issue #15
 * pointed at (U+2580–U+259F), plus a couple of solid shapes people reach for.
 *
 * Anything narrower than a full block leaves gaps a reader's eye can follow, so
 * the shading options are there for looks, not for secrecy — the redaction is
 * equally irreversible either way.
 */

export interface MaskChar {
  char: string
  /** Unicode name, shown as the option's title. */
  name: string
  code: string
}

export const MASK_CHARS: MaskChar[] = [
  { char: '█', name: 'Full block', code: 'U+2588' },
  { char: '▓', name: 'Dark shade', code: 'U+2593' },
  { char: '▒', name: 'Medium shade', code: 'U+2592' },
  { char: '░', name: 'Light shade', code: 'U+2591' },
  { char: '▀', name: 'Upper half block', code: 'U+2580' },
  { char: '▄', name: 'Lower half block', code: 'U+2584' },
  { char: '▌', name: 'Left half block', code: 'U+258C' },
  { char: '■', name: 'Black square', code: 'U+25A0' },
  { char: '●', name: 'Black circle', code: 'U+25CF' },
  { char: '×', name: 'Multiplication sign', code: 'U+00D7' },
]

export const DEFAULT_MASK = MASK_CHARS[0].char

/**
 * What the browser can actually do with each format, in one table.
 *
 * Encoding is canvas-based (`convertToBlob` / `toBlob`), so the honest output
 * list is PNG, JPEG, WebP — plus GIF, which has no browser encoder at all and
 * is written by hand in ../gif/. SVG is input-only: turning pixels back into
 * vectors is tracing, not conversion, so the tool does not pretend to.
 */

export type OutFormat = 'png' | 'jpeg' | 'webp' | 'gif'
/** `keep` re-encodes each file into whatever it already was. */
export type FormatChoice = OutFormat | 'keep'
export type InFormat = OutFormat | 'svg' | 'bmp' | 'avif' | 'unknown'

export interface FormatInfo {
  id: OutFormat
  label: string
  mime: string
  ext: string
  /** The encoder honours a 0–1 quality setting (so a size target can hit it). */
  quality: boolean
  /** Alpha survives the round-trip. */
  alpha: boolean
  /** Shown under the format picker when this format is selected. */
  note?: string
}

export const OUT_FORMATS: FormatInfo[] = [
  {
    id: 'png',
    label: 'PNG',
    mime: 'image/png',
    ext: 'png',
    quality: false,
    alpha: true,
    note: 'Lossless, so there is no quality dial — a size target can only be met by scaling down.',
  },
  {
    id: 'jpeg',
    label: 'JPEG',
    mime: 'image/jpeg',
    ext: 'jpg',
    quality: true,
    alpha: false,
    note: 'No transparency: transparent pixels are flattened onto the background colour.',
  },
  { id: 'webp', label: 'WebP', mime: 'image/webp', ext: 'webp', quality: true, alpha: true },
  {
    id: 'gif',
    label: 'GIF',
    mime: 'image/gif',
    ext: 'gif',
    quality: false,
    alpha: true,
    note: 'Max 256 colours, encoded here in your browser. Animation is not preserved.',
  },
]

const BY_ID = new Map(OUT_FORMATS.map((f) => [f.id, f]))

export function formatInfo(id: OutFormat): FormatInfo {
  const info = BY_ID.get(id)
  if (!info) throw new Error(`Unknown output format: ${id}`)
  return info
}

/**
 * Which format a file should become. `keep` maps a source format to itself,
 * except for the ones we cannot write back — those become PNG, the lossless
 * default that keeps transparency.
 */
export function resolveFormat(choice: FormatChoice, source: InFormat): OutFormat {
  if (choice !== 'keep') return choice
  return BY_ID.has(source as OutFormat) ? (source as OutFormat) : 'png'
}

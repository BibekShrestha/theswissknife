/**
 * The size an SVG asks to be drawn at, read from its root element only.
 *
 * Pure string work (no DOMParser) so it runs anywhere and is testable: the
 * prolog — XML declaration, comments, processing instructions, doctype — is
 * skipped, then the root start tag is split into real attributes, honouring
 * quotes, so `stroke-width` is never mistaken for `width`.
 */

import type { Size } from './dimensions'

/** Used when an SVG declares no absolute size, only a viewBox (or nothing at all). */
export const SVG_FALLBACK_LONG_EDGE = 1024

export interface SvgSize {
  intrinsic: Size
  /** True when the size came from the fallback rather than the file. */
  assumed: boolean
  /** Why the size was assumed — shown to the user. */
  note?: string
}

/** CSS absolute units in px, at the 96 dpi browsers use. */
const UNITS: Record<string, number> = { '': 1, px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6, pt: 96 / 72, pc: 16 }
const NUMBER = /^\s*\+?((?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z%]*)\s*$/i

type Length = { px: number } | { relative: string } | null

/** A width/height value: an absolute length in px, a relative one (%, em, …), or nothing usable. */
function length(value: string | undefined): Length {
  if (value === undefined) return null
  const m = NUMBER.exec(value)
  if (!m) return null
  const unit = m[2].toLowerCase()
  const factor = UNITS[unit]
  if (factor === undefined) return { relative: unit }
  const px = Number(m[1]) * factor
  return Number.isFinite(px) && px > 0 ? { px } : null
}

/** Index just past the prolog, or -1 if the text ends inside it. */
function skipProlog(text: string): number {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++
    if (text.startsWith('<?', i)) i = text.indexOf('?>', i + 2)
    else if (text.startsWith('<!--', i)) i = text.indexOf('-->', i + 4)
    else if (text.slice(i, i + 9).toUpperCase() === '<!DOCTYPE') {
      // A doctype may carry an internal subset in [ ]; its own end is the > after that.
      const bracket = text.indexOf('[', i)
      const close = text.indexOf('>', i)
      if (bracket >= 0 && bracket < close) {
        const end = text.indexOf(']', bracket)
        i = end < 0 ? -1 : text.indexOf('>', end)
      } else i = close
    } else return i
    if (i < 0) return -1
    i += text[i] === '?' || text[i] === ']' ? 2 : text[i] === '-' ? 3 : 1
  }
}

/** The root element's name and attributes, or null when the root is not <svg>. */
export function rootSvgAttributes(text: string): Map<string, string> | null {
  const start = skipProlog(text)
  if (start < 0) return null
  const head = /^<((?:[\w.-]+:)?svg)(?=[\s/>])/i.exec(text.slice(start, start + 64))
  if (!head) return null
  const attrs = new Map<string, string>()
  const re = /\s*([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?|\s*(\/?>)/y
  re.lastIndex = start + head[0].length
  for (let m = re.exec(text); m && !m[3]; m = re.exec(text)) {
    const raw = m[2] ?? ''
    const value = raw.startsWith('"') || raw.startsWith("'") ? raw.slice(1, -1) : raw
    if (!attrs.has(m[1].toLowerCase())) attrs.set(m[1].toLowerCase(), value)
  }
  return attrs
}

function viewBox(value: string | undefined): { width: number; height: number } | null {
  const parts = value?.trim().split(/[\s,]+/).map(Number)
  if (!parts || parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null
  const [, , width, height] = parts
  return width > 0 && height > 0 ? { width, height } : null
}

export function svgSize(text: string): SvgSize {
  const attrs = rootSvgAttributes(text) ?? new Map<string, string>()
  const w = length(attrs.get('width'))
  const h = length(attrs.get('height'))
  const box = viewBox(attrs.get('viewbox'))
  const width = w && 'px' in w ? w.px : null
  const height = h && 'px' in h ? h.px : null
  if (width && height) return { intrinsic: { width, height }, assumed: false }
  if (box && width) return { intrinsic: { width, height: (width * box.height) / box.width }, assumed: false }
  if (box && height) return { intrinsic: { width: (height * box.width) / box.height, height }, assumed: false }

  const relative = [w, h].find((x) => x && 'relative' in x) as { relative: string } | undefined
  const why = relative ? `This SVG’s size is relative (${relative.relative})` : 'This SVG declares no size'
  if (box) {
    const scale = SVG_FALLBACK_LONG_EDGE / Math.max(box.width, box.height)
    return { intrinsic: { width: box.width * scale, height: box.height * scale }, assumed: true, note: `${why} — rasterised at ${SVG_FALLBACK_LONG_EDGE} px on the long edge, in its viewBox shape` }
  }
  const side = width ?? height ?? SVG_FALLBACK_LONG_EDGE
  return {
    intrinsic: { width: side, height: side },
    assumed: true,
    note: width || height ? 'This SVG gives one side and no viewBox — rasterised square' : `${why} and has no viewBox — rasterised at ${side} px square`,
  }
}

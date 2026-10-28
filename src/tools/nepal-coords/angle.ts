/**
 * Latitude/longitude text: decimal degrees or degrees-minutes-seconds, with
 * a sign or a hemisphere letter, and Devanagari digits read as ASCII (the
 * land tool's rule, copied). Parsing is linear and never quotes more than a
 * few characters of its input back in an error.
 */

export type AngleKind = 'lat' | 'lon'

/** Devanagari digits (०–९) as ASCII. */
export function asciiDigits(text: string): string {
  return text.replace(/[०-९]/g, (c) => String(c.charCodeAt(0) - 0x0966))
}

/** A short, safe excerpt of user text for a message. */
export function clip(text: string, max = 12): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

export type AngleResult =
  | { ok: true; value: number; /** Set when the text named its hemisphere. */ kind?: AngleKind }
  | { ok: false; error: string }

/** Symbols between the parts: degree, minute, second marks (straight, curly, prime) and colons. */
const SEPARATORS = /[°º˚d'′’‘m"″”“s:\s]+/gi
const PART = /^(\d+(\.\d*)?|\.\d+)$/

/**
 * Reads one angle. `kind` is what the caller expects; a hemisphere letter
 * that contradicts it is an error. Without `kind`, the letter decides and
 * is reported back (batch lines use this to tell latitude from longitude).
 */
export function parseAngle(input: string, kind?: AngleKind): AngleResult {
  let text = asciiDigits(input).trim()
  if (!text) return { ok: false, error: 'Empty' }
  if (text.length > 40) return { ok: false, error: 'Too long for an angle' }

  let sign = 1
  let hemisphere: string | null = null
  const lead = /^[NSEW]/i.exec(text)
  // "27d42m36.5s" or 27°42'36.5s: a lowercase s after the minutes is the seconds mark, not south.
  const secondsMark = /[m'′’]\s*[\d.]+\s*s$/.test(text)
  const trail = secondsMark ? null : /[NSEW]$/i.exec(text)
  if (lead && trail && text.length > 1) return { ok: false, error: 'Give the hemisphere letter once' }
  if (lead || trail) {
    hemisphere = (lead ?? trail)![0].toUpperCase()
    text = lead ? text.slice(1).trim() : text.slice(0, -1).trim()
  }
  if (/^[-−+]/.test(text)) {
    if (/^[-−]/.test(text)) sign = -1
    if (hemisphere && sign === -1) return { ok: false, error: 'Use a minus sign or a hemisphere letter, not both' }
    text = text.slice(1).trim()
  }

  let found: AngleKind | undefined
  if (hemisphere) {
    found = hemisphere === 'N' || hemisphere === 'S' ? 'lat' : 'lon'
    if (kind && found !== kind) return { ok: false, error: kind === 'lat' ? 'A latitude ends in N or S' : 'A longitude ends in E or W' }
    if (hemisphere === 'S' || hemisphere === 'W') sign = -1
  }

  // A decimal comma ("27,7172") is not read: commas separate columns in batch input.
  if (text.includes(',')) return { ok: false, error: 'Use a decimal point, not a comma' }
  const parts = text.split(SEPARATORS).filter(Boolean)
  if (parts.length === 0 || parts.length > 3) return { ok: false, error: `“${clip(input)}” is not an angle` }
  if (!parts.every((p) => PART.test(p))) return { ok: false, error: `“${clip(input)}” is not an angle` }
  const nums = parts.map(Number)
  // Only the last part may have a fraction: 27.5 or 27 30.5 or 27 30 15.25.
  if (nums.slice(0, -1).some((v, i) => !Number.isInteger(v) || parts[i].includes('.'))) {
    return { ok: false, error: 'Only the last part (degrees, minutes or seconds) may have decimals' }
  }
  const [d, m = 0, s = 0] = nums
  if (m >= 60) return { ok: false, error: 'Minutes must be under 60' }
  if (s >= 60) return { ok: false, error: 'Seconds must be under 60' }
  const value = sign * (d + m / 60 + s / 3600)
  const which = kind ?? found
  const limit = which === 'lon' ? 180 : which === 'lat' ? 90 : 180
  if (Math.abs(value) > limit) return { ok: false, error: which === 'lat' ? 'Latitude must be between −90 and 90' : 'Longitude must be between −180 and 180' }
  return found ? { ok: true, value, kind: found } : { ok: true, value }
}

/** Decimal degrees, fixed digits (8 ≈ 1 mm). */
export function formatDecimal(value: number, digits = 8): string {
  return value.toFixed(digits)
}

/**
 * Degrees, minutes and seconds with a hemisphere letter, in the ASCII form
 * Google Earth and most GIS accept: 27°42'36.500"N. Seconds are rounded
 * first so 59.9999 carries into the minute rather than printing 60.
 */
export function formatDms(value: number, kind: AngleKind, secondDigits = 4): string {
  const hemisphere = kind === 'lat' ? (value < 0 ? 'S' : 'N') : value < 0 ? 'W' : 'E'
  const scale = 10 ** secondDigits
  const total = Math.round(Math.abs(value) * 3600 * scale)
  const perMinute = 60 * scale
  const perDegree = 3600 * scale
  const d = Math.floor(total / perDegree)
  const m = Math.floor((total % perDegree) / perMinute)
  const s = (total % perMinute) / scale
  const sText = s.toFixed(secondDigits).padStart(secondDigits ? secondDigits + 3 : 2, '0')
  return `${d}°${String(m).padStart(2, '0')}'${sText}"${hemisphere}`
}

/**
 * A pasted pair ("27.7172, 85.3240" or "27°43'N 85°19'E") → both angles, or
 * null if the text is not clearly a pair. Used when a pair is pasted into
 * one field.
 */
export function parsePair(input: string): { lat: number; lon: number } | null {
  const text = asciiDigits(input).trim()
  if (!text || text.length > 80) return null
  let halves: string[] | null = null
  if (/[,;\t]/.test(text)) halves = text.split(/\s*[,;\t]\s*/).filter(Boolean)
  else {
    // "27°43'N 85°19'E": split after the first hemisphere letter.
    const m = /^(.*?[NS])\s+(.*[EW])$/i.exec(text)
    if (m) halves = [m[1], m[2]]
    else {
      const words = text.split(/\s+/)
      if (words.length === 2) halves = words
    }
  }
  if (!halves || halves.length !== 2) return null
  const a = parseAngle(halves[0]), b = parseAngle(halves[1])
  if (!a.ok || !b.ok) return null
  if (a.kind === 'lon' || b.kind === 'lat') return { lat: b.value, lon: a.value }
  if (a.kind || b.kind) return { lat: a.value, lon: b.value }
  // No letters: batch's 'auto' rule — across Nepal the longitude is the larger
  // number, so a KML/GeoJSON-order "85.324, 27.7172" still lands right.
  return Math.abs(a.value) > Math.abs(b.value) ? { lat: b.value, lon: a.value } : { lat: a.value, lon: b.value }
}

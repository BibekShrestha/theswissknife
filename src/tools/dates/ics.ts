/**
 * A single-event iCalendar file (RFC 5545), written by hand. Times are UTC
 * ("Z" form), so no VTIMEZONE block is needed; every calendar converts them to
 * the viewer's zone.
 */

export interface IcsEvent {
  uid: string
  /** Epoch ms when the file was made (DTSTAMP). */
  stamp: number
  start: number
  end: number
  summary: string
  description?: string
}

const ICS_RANGE = 'iCalendar dates need a four-digit year — this time falls outside years 0000–9999 (UTC).'

/** 20260329T090000Z. Throws RangeError outside years 0000–9999, which RFC 5545 DATE-TIME cannot hold. */
export function icsUtc(ms: number): string {
  const year = new Date(ms).getUTCFullYear()
  if (!(year >= 0 && year <= 9999)) throw new RangeError(ICS_RANGE)
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '')
}

/** Why an event from `start` to `end` cannot be written as .ics, or null when it can. */
export function icsRangeError(start: number, end: number): string | null {
  try {
    icsUtc(start)
    icsUtc(end)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** TEXT escaping (RFC 5545 §3.3.11): backslash, semicolon, comma and newlines. */
export function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

const encoder = new TextEncoder()

/**
 * Folds a content line so no physical line exceeds 75 octets (§3.1).
 * Continuation lines start with one space, which counts toward their 75.
 * Never splits a UTF-8 sequence (or a surrogate pair).
 */
export function foldLine(line: string): string {
  const out: string[] = []
  let current = ''
  let bytes = 0
  for (const ch of line) {
    const size = encoder.encode(ch).length
    const limit = out.length === 0 ? 75 : 74
    if (bytes + size > limit) {
      out.push(current)
      current = ''
      bytes = 0
    }
    current += ch
    bytes += size
  }
  out.push(current)
  return out.join('\r\n ')
}

export function buildIcs(event: IcsEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//The Swiss Knife//Dates and time zones//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${icsUtc(event.stamp)}`,
    `DTSTART:${icsUtc(event.start)}`,
    `DTEND:${icsUtc(event.end)}`,
    `SUMMARY:${escapeText(event.summary)}`,
    ...(event.description ? [`DESCRIPTION:${escapeText(event.description)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(foldLine).join('\r\n') + '\r\n'
}

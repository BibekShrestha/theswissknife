/**
 * Turns the friendly preset forms into the exact strings phones understand.
 * Every builder is pure so the formats can be pinned by tests — a stray
 * unescaped `;` in a Wi-Fi password silently breaks the join on a phone.
 */

export type PresetId = 'text' | 'wifi' | 'email' | 'phone' | 'sms' | 'contact' | 'geo' | 'event'

export interface Preset {
  id: PresetId
  label: string
  icon: string
}

export const presets: Preset[] = [
  { id: 'text', label: 'Text / URL', icon: 'link' },
  { id: 'wifi', label: 'Wi-Fi', icon: 'wifi' },
  { id: 'email', label: 'Email', icon: 'mail' },
  { id: 'phone', label: 'Phone', icon: 'call' },
  { id: 'sms', label: 'SMS', icon: 'sms' },
  { id: 'contact', label: 'Contact', icon: 'contact_page' },
  { id: 'geo', label: 'Location', icon: 'location_on' },
  { id: 'event', label: 'Event', icon: 'event' },
]

export type Fields = Record<string, string>

export interface PayloadResult {
  payload: string
  /** Blocks generation — the form can't produce a meaningful code yet. */
  error?: string
}

/** Wi-Fi (ZXing MECARD-style) fields escape `\ ; , : "` with a backslash. */
export function escapeWifi(value: string): string {
  return value.replace(/([\\;,:"])/g, '\\$1')
}

/** vCard 3.0 text values escape backslash, comma, semicolon and newlines. */
export function escapeVcard(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\r?\n/g, '\\n')
}

/** iCalendar text values use the same escaping as vCard. */
const escapeIcal = escapeVcard

/** Keeps the dial string a phone would accept: digits, +, *, #, comma pauses. */
export function cleanPhone(value: string): string {
  return value.replace(/[^\d+*#,]/g, '')
}

/** `2026-10-03T14:30` (datetime-local) → `20261003T143000` (floating local time). */
export function icalDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value)
  if (!m) return ''
  return m[4] ? `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}00` : `${m[1]}${m[2]}${m[3]}`
}

const has = (v: string | undefined): v is string => Boolean(v && v.trim())

export function buildPayload(preset: PresetId, f: Fields): PayloadResult {
  switch (preset) {
    case 'text':
      return f.text ? { payload: f.text } : { payload: '', error: 'Type some text or paste a URL' }

    case 'wifi': {
      if (!has(f.ssid)) return { payload: '', error: 'Network name (SSID) is required' }
      const security = f.security || 'WPA'
      if (security !== 'nopass' && !f.password) return { payload: '', error: 'Password is required for a secured network' }
      let out = `WIFI:T:${security};S:${escapeWifi(f.ssid)};`
      if (security !== 'nopass') out += `P:${escapeWifi(f.password)};`
      if (f.hidden === 'true') out += 'H:true;'
      return { payload: `${out};` }
    }

    case 'email': {
      if (!has(f.to) && !has(f.subject) && !has(f.body)) return { payload: '', error: 'Add a recipient, subject or body' }
      const query = [
        has(f.subject) && `subject=${encodeURIComponent(f.subject)}`,
        has(f.body) && `body=${encodeURIComponent(f.body)}`,
      ].filter(Boolean).join('&')
      return { payload: `mailto:${(f.to ?? '').trim()}${query ? `?${query}` : ''}` }
    }

    case 'phone': {
      const number = cleanPhone(f.number ?? '')
      return number ? { payload: `tel:${number}` } : { payload: '', error: 'Enter a phone number' }
    }

    case 'sms': {
      const number = cleanPhone(f.number ?? '')
      if (!number) return { payload: '', error: 'Enter a phone number' }
      return { payload: has(f.message) ? `SMSTO:${number}:${f.message}` : `SMSTO:${number}` }
    }

    case 'contact': {
      const first = (f.first ?? '').trim()
      const last = (f.last ?? '').trim()
      if (!first && !last && !has(f.org)) return { payload: '', error: 'Add a name or organisation' }
      const full = [first, last].filter(Boolean).join(' ') || f.org.trim()
      const lines = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `N:${escapeVcard(last)};${escapeVcard(first)};;;`,
        `FN:${escapeVcard(full)}`,
        has(f.org) && `ORG:${escapeVcard(f.org.trim())}`,
        has(f.title) && `TITLE:${escapeVcard(f.title.trim())}`,
        has(f.phone) && `TEL;TYPE=CELL:${cleanPhone(f.phone)}`,
        has(f.email) && `EMAIL:${escapeVcard(f.email.trim())}`,
        has(f.url) && `URL:${escapeVcard(f.url.trim())}`,
        // ADR is structured; a single free-form line goes in the street slot.
        has(f.address) && `ADR:;;${escapeVcard(f.address.trim())};;;;`,
        has(f.note) && `NOTE:${escapeVcard(f.note)}`,
        'END:VCARD',
      ].filter(Boolean)
      return { payload: lines.join('\r\n') }
    }

    case 'geo': {
      const lat = Number(f.lat)
      const lng = Number(f.lng)
      if (!has(f.lat) || !has(f.lng) || Number.isNaN(lat) || Number.isNaN(lng)) return { payload: '', error: 'Enter latitude and longitude as numbers' }
      if (Math.abs(lat) > 90) return { payload: '', error: 'Latitude must be between −90 and 90' }
      if (Math.abs(lng) > 180) return { payload: '', error: 'Longitude must be between −180 and 180' }
      const point = `${lat},${lng}`
      return { payload: has(f.label) ? `geo:${point}?q=${point}(${encodeURIComponent(f.label.trim())})` : `geo:${point}` }
    }

    case 'event': {
      if (!has(f.title)) return { payload: '', error: 'Give the event a title' }
      const start = icalDate(f.start ?? '')
      if (!start) return { payload: '', error: 'Pick a start time' }
      const end = icalDate(f.end ?? '')
      if (end && end < start) return { payload: '', error: 'End must be after start' }
      const lines = [
        'BEGIN:VEVENT',
        `SUMMARY:${escapeIcal(f.title.trim())}`,
        `DTSTART:${start}`,
        end && `DTEND:${end}`,
        has(f.location) && `LOCATION:${escapeIcal(f.location.trim())}`,
        has(f.description) && `DESCRIPTION:${escapeIcal(f.description)}`,
        'END:VEVENT',
      ].filter(Boolean)
      return { payload: lines.join('\r\n') }
    }
  }
}

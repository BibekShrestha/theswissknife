/**
 * Reads a decoded QR payload back into something a person can check: the
 * inverse of `../payload.ts`, plus the common formats other generators emit
 * (MECARD, `sms:` URIs, events wrapped in a VCALENDAR).
 */

import { buildPayload, type Fields, type PresetId } from '../payload'
import type { Ecc } from '../render'

export type Kind = 'url' | 'wifi' | 'email' | 'phone' | 'sms' | 'contact' | 'geo' | 'event' | 'text'

export interface Field {
  label: string
  value: string
  /** Hidden until the viewer asks — a Wi-Fi password on a shared screen. */
  secret?: boolean
}

export interface Described {
  kind: Kind
  label: string
  icon: string
  fields: Field[]
  /** Only ever an http(s) URL; nothing is opened unless the viewer clicks. */
  href?: string
}

const KINDS: Record<Kind, [string, string]> = {
  url: ['Link', 'link'],
  wifi: ['Wi-Fi network', 'wifi'],
  email: ['Email', 'mail'],
  phone: ['Phone number', 'call'],
  sms: ['SMS', 'sms'],
  contact: ['Contact', 'contact_page'],
  geo: ['Location', 'location_on'],
  event: ['Event', 'event'],
  text: ['Text', 'notes'],
}

function make(kind: Kind, fields: (Field | false | undefined)[], href?: string): Described {
  const [label, icon] = KINDS[kind]
  return { kind, label, icon, fields: fields.filter((f): f is Field => Boolean(f && f.value)), ...(href ? { href } : {}) }
}

const field = (label: string, value: string | undefined, secret?: boolean): Field | undefined =>
  value ? { label, value, ...(secret ? { secret } : {}) } : undefined

/**
 * Splits `KEY:value;KEY:value;;` (Wi-Fi, MECARD) on unescaped `;` and drops
 * the backslash escapes. Keys are upper-cased; a repeated key keeps the first.
 */
export function splitKeyed(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  let part = ''
  const flush = () => {
    // Keys never contain escapes, so the first colon always ends the key.
    const colon = part.indexOf(':')
    if (colon > 0) {
      const key = part.slice(0, colon).toUpperCase()
      out[key] ??= part.slice(colon + 1).replace(/\\(.)/g, '$1')
    }
    part = ''
  }
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '\\' && i + 1 < body.length) part += ch + body[++i]
    else if (ch === ';') flush()
    else part += ch
  }
  flush()
  return out
}

/** vCard / iCalendar text unescaping: `\n` `\,` `\;` `\\`. */
export function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c))
}

/** Unfolds continuation lines and returns `[NAME, value]` pairs, parameters dropped. */
function contentLines(text: string): [string, string][] {
  const unfolded = text.replace(/\r?\n[ \t]/g, '')
  const out: [string, string][] = []
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    out.push([line.slice(0, colon).split(';')[0].toUpperCase(), line.slice(colon + 1)])
  }
  return out
}

/** `20261003T143000` → `2026-10-03 14:30`, keeping a trailing `Z` as UTC. */
export function readIcalDate(value: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim())
  if (!m) return value
  const date = `${m[1]}-${m[2]}-${m[3]}`
  return m[4] ? `${date} ${m[4]}:${m[5]}${m[7] ? ' UTC' : ''}` : date
}

/** Percent-decoding only: in tel:, sms: and mailto: a `+` is literal (`+44…`, `me+tag@…`). */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function vcard(text: string): Described {
  const get = new Map<string, string[]>()
  for (const [name, value] of contentLines(text)) get.set(name, [...(get.get(name) ?? []), value])
  const one = (name: string) => get.get(name)?.[0]
  const all = (name: string) => (get.get(name) ?? []).map(unescapeText).join('\n')
  let name = one('FN') && unescapeText(one('FN')!)
  if (!name && one('N')) {
    const [last = '', first = ''] = one('N')!.split(/(?<!\\);/).map(unescapeText)
    name = [first, last].filter(Boolean).join(' ')
  }
  const adr = (get.get('ADR') ?? []).map((a) => a.split(/(?<!\\);/).map(unescapeText).filter(Boolean).join(', ')).join('\n')
  return make('contact', [
    field('Name', name),
    field('Organisation', one('ORG') && unescapeText(one('ORG')!).replace(/;/g, ', ')),
    field('Job title', one('TITLE') && unescapeText(one('TITLE')!)),
    field('Phone', all('TEL')),
    field('Email', all('EMAIL')),
    field('Website', all('URL')),
    field('Address', adr),
    field('Note', one('NOTE') && unescapeText(one('NOTE')!)),
  ])
}

function mecard(body: string): Described {
  const f = splitKeyed(body)
  const [last = '', first = ''] = (f.N ?? '').split(',')
  return make('contact', [
    field('Name', [first, last].map((s) => s.trim()).filter(Boolean).join(' ')),
    field('Organisation', f.ORG),
    field('Phone', f.TEL),
    field('Email', f.EMAIL),
    field('Website', f.URL),
    field('Address', f.ADR),
    field('Note', f.NOTE),
  ])
}

function vevent(text: string): Described {
  const get = new Map<string, string>()
  for (const [name, value] of contentLines(text)) if (!get.has(name)) get.set(name, value)
  const text_ = (name: string) => get.has(name) ? unescapeText(get.get(name)!) : undefined
  return make('event', [
    field('Title', text_('SUMMARY')),
    field('Starts', get.has('DTSTART') ? readIcalDate(get.get('DTSTART')!) : undefined),
    field('Ends', get.has('DTEND') ? readIcalDate(get.get('DTEND')!) : undefined),
    field('Location', text_('LOCATION')),
    field('Description', text_('DESCRIPTION')),
  ])
}

export function describe(raw: string): Described {
  const text = raw.trim()

  if (/^WIFI:/i.test(text)) {
    const f = splitKeyed(text.slice(5))
    const security = f.T || 'nopass'
    return make('wifi', [
      field('Network (SSID)', f.S),
      field('Security', security === 'nopass' ? 'None (open)' : security),
      security !== 'nopass' && field('Password', f.P, true),
      f.H?.toLowerCase() === 'true' && field('Hidden', 'Yes'),
    ])
  }

  if (/^BEGIN:VCARD/i.test(text)) return vcard(text)
  if (/^MECARD:/i.test(text)) return mecard(text.slice(7))
  if (/^BEGIN:(VEVENT|VCALENDAR)/i.test(text)) return vevent(text)

  if (/^mailto:/i.test(text)) {
    const [to, query = ''] = text.slice(7).split('?')
    const params = new Map(query.split('&').filter(Boolean).map((kv) => {
      const eq = kv.indexOf('=')
      return [safeDecode(eq < 0 ? kv : kv.slice(0, eq)).toLowerCase(), safeDecode(eq < 0 ? '' : kv.slice(eq + 1))] as const
    }))
    return make('email', [
      field('To', safeDecode(to)),
      field('Cc', params.get('cc')),
      field('Subject', params.get('subject')),
      field('Body', params.get('body')),
    ])
  }

  if (/^tel:/i.test(text)) return make('phone', [field('Number', safeDecode(text.slice(4)))])

  if (/^SMSTO:/i.test(text)) {
    const rest = text.slice(6)
    const colon = rest.indexOf(':')
    return make('sms', [
      field('Number', colon < 0 ? rest : rest.slice(0, colon)),
      field('Message', colon < 0 ? undefined : rest.slice(colon + 1)),
    ])
  }

  if (/^sms:/i.test(text)) {
    const [number, query = ''] = text.slice(4).split('?')
    const body = /(?:^|&)body=([^&]*)/i.exec(query)?.[1]
    return make('sms', [field('Number', safeDecode(number)), field('Message', body && safeDecode(body))])
  }

  if (/^geo:/i.test(text)) {
    const m = /^geo:(-?[\d.]+),(-?[\d.]+)[^?]*(?:\?(.*))?$/i.exec(text)
    if (m) {
      const label = m[3] && /(?:^|&)q=[^&(]*\(([^)]*)\)/.exec(m[3])?.[1]
      return make('geo', [field('Latitude', m[1]), field('Longitude', m[2]), field('Label', label && safeDecode(label))])
    }
  }

  // Only a single token is a link; prose that happens to start with a URL is text.
  if (/^https?:\/\/\S+$/i.test(text)) {
    try {
      const url = new URL(text)
      // `hostname` is the punycode form, so a look-alike domain shows as xn--…
      return make('url', [field('Host', url.hostname), field('Address', url.href)], url.href)
    } catch { /* not a parseable URL — fall through to text */ }
  }

  return make('text', [])
}

/** A scanned payload as the generator's form would hold it. */
export interface Form {
  preset: PresetId
  fields: Fields
  /** Error-correction level read from the code, so a re-made code keeps it. */
  ecc?: Ecc
  /** The form rebuilds the payload byte for byte; when not, Edit as text is the faithful route. */
  exact: boolean
}

/** `20261003T143000` → `2026-10-03T14:30` for a datetime-local input; `Z` times move to local. */
export function toLocalInput(value: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim())
  if (!m) return ''
  if (!m[7]) return `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}`
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)))
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** The raw payload in the Text preset — always exact. */
export function asText(raw: string, ecc?: string): Form {
  return { preset: 'text', fields: { text: raw }, exact: true, ...eccOf(ecc) }
}

// A literal list, not render.ts's ECC_LEVELS: that import would pull the encoder into the scanner chunk.
const eccOf = (ecc?: string): { ecc?: Ecc } => ['L', 'M', 'Q', 'H'].includes(ecc ?? '') ? { ecc: ecc as Ecc } : {}

function fieldsOf(raw: string): [PresetId, Fields] {
  const text = raw.trim()

  if (/^WIFI:/i.test(text)) {
    const f = splitKeyed(text.slice(5))
    const t = (f.T ?? '').toUpperCase()
    const security = !t || t === 'NOPASS' ? 'nopass' : t === 'WEP' ? 'WEP' : 'WPA'
    return ['wifi', { ssid: f.S ?? '', security, password: security === 'nopass' ? '' : f.P ?? '', hidden: f.H?.toLowerCase() === 'true' ? 'true' : '' }]
  }

  if (/^BEGIN:VCARD/i.test(text)) {
    const get = new Map<string, string>()
    for (const [name, value] of contentLines(text)) if (!get.has(name)) get.set(name, value)
    const one = (name: string) => unescapeText(get.get(name) ?? '')
    // Structured values split on unescaped `;` only; an escaped one is part of the text.
    const parts = (name: string) => (get.get(name) ?? '').split(/(?<!\\);/).map(unescapeText).filter(Boolean).join(', ')
    let [last = '', first = ''] = (get.get('N') ?? '').split(/(?<!\\);/).map(unescapeText)
    if (!first && !last) first = one('FN')
    return ['contact', {
      first, last,
      org: parts('ORG'),
      title: one('TITLE'),
      phone: one('TEL'),
      email: one('EMAIL'),
      url: one('URL'),
      address: parts('ADR'),
      note: one('NOTE'),
    }]
  }

  if (/^MECARD:/i.test(text)) {
    const f = splitKeyed(text.slice(7))
    const [last = '', first = ''] = (f.N ?? '').split(',').map((s) => s.trim())
    return ['contact', { first, last, org: f.ORG ?? '', phone: f.TEL ?? '', email: f.EMAIL ?? '', url: f.URL ?? '', address: f.ADR ?? '', note: f.NOTE ?? '' }]
  }

  if (/^BEGIN:(VEVENT|VCALENDAR)/i.test(text)) {
    const get = new Map<string, string>()
    for (const [name, value] of contentLines(text)) if (!get.has(name)) get.set(name, value)
    const one = (name: string) => unescapeText(get.get(name) ?? '')
    return ['event', {
      title: one('SUMMARY'),
      start: toLocalInput(get.get('DTSTART') ?? ''),
      end: toLocalInput(get.get('DTEND') ?? ''),
      location: one('LOCATION'),
      description: one('DESCRIPTION'),
    }]
  }

  // Everything else reuses describe(): its fields are already decoded.
  const info = describe(text)
  const v = (label: string) => info.fields.find((f) => f.label === label)?.value ?? ''
  switch (info.kind) {
    case 'email': return ['email', { to: v('To'), subject: v('Subject'), body: v('Body') }]
    case 'phone': return ['phone', { number: v('Number') }]
    case 'sms': return ['sms', { number: v('Number'), message: v('Message') }]
    case 'geo': return ['geo', { lat: v('Latitude'), lng: v('Longitude'), label: v('Label') }]
    default: return ['text', { text: raw }]
  }
}

/** Fills the generator's form from a scanned payload: the inverse of `buildPayload`. */
export function toForm(raw: string, ecc?: string): Form {
  const [preset, fields] = fieldsOf(raw)
  const built = buildPayload(preset, fields)
  return { preset, fields, exact: !built.error && built.payload === raw, ...eccOf(ecc) }
}

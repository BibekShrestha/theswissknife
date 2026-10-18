/**
 * The zone list and its search: IANA ids, city names (including a few big
 * cities that are not zone ids) and common abbreviations. Abbreviations are
 * not standardised — IST is India, Ireland and Israel — so each one lists the
 * zones it can mean and whether those disagree.
 */

type SupportedValues = typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }

/** Older ids some engines still list, mapped to the current IANA name. */
export const RENAMED: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Europe/Kiev': 'Europe/Kyiv',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Rangoon': 'Asia/Yangon',
  'America/Godthab': 'America/Nuuk',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Pacific/Enderbury': 'Pacific/Kanton',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'Asia/Dacca': 'Asia/Dhaka',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Truk': 'Pacific/Chuuk',
}

const OLD_NAME: Record<string, string> = Object.fromEntries(Object.entries(RENAMED).map(([old, now]) => [now, old]))

/** Cities people search for that are not themselves zone ids. */
const CITIES: Record<string, string[]> = {
  'America/Los_Angeles': ['San Francisco', 'Seattle', 'San Diego', 'Portland', 'Las Vegas', 'Silicon Valley'],
  'America/New_York': ['Boston', 'Washington', 'Philadelphia', 'Atlanta', 'Miami', 'Pittsburgh'],
  'America/Chicago': ['Dallas', 'Houston', 'Austin', 'Minneapolis', 'New Orleans'],
  'America/Denver': ['Salt Lake City', 'Albuquerque'],
  'America/Phoenix': ['Arizona'],
  'America/Toronto': ['Montreal', 'Ottawa'],
  'Asia/Kolkata': ['Delhi', 'New Delhi', 'Mumbai', 'Bangalore', 'Bengaluru', 'Chennai', 'Hyderabad', 'Pune', 'India'],
  'Asia/Shanghai': ['Beijing', 'Shenzhen', 'Guangzhou', 'China'],
  'Asia/Tokyo': ['Osaka', 'Kyoto', 'Japan'],
  'Asia/Jerusalem': ['Tel Aviv', 'Israel'],
  'Asia/Dubai': ['Abu Dhabi', 'UAE'],
  'Asia/Kathmandu': ['Nepal'],
  'Asia/Seoul': ['Korea'],
  'Asia/Singapore': ['Singapore'],
  'Europe/Berlin': ['Munich', 'Frankfurt', 'Hamburg', 'Germany'],
  'Europe/London': ['Manchester', 'Edinburgh', 'UK', 'Britain'],
  'Europe/Paris': ['France', 'Lyon'],
  'Europe/Madrid': ['Barcelona', 'Spain'],
  'Europe/Rome': ['Milan', 'Italy'],
  'Europe/Zurich': ['Geneva', 'Switzerland'],
  'Europe/Amsterdam': ['Netherlands', 'Rotterdam'],
  'Australia/Sydney': ['Canberra', 'NSW'],
  'Australia/Lord_Howe': ['Lord Howe Island'],
  'Pacific/Auckland': ['Wellington', 'New Zealand'],
  'America/Sao_Paulo': ['Rio de Janeiro', 'Brazil'],
  'Africa/Lagos': ['Nigeria', 'Abuja'],
  'Africa/Johannesburg': ['Cape Town', 'South Africa'],
}

export interface Abbreviation {
  /** One entry per distinct meaning. */
  meanings: { label: string, zones: string[] }[]
  note?: string
}

export const ABBREVIATIONS: Record<string, Abbreviation> = {
  UTC: { meanings: [{ label: 'Coordinated Universal Time', zones: ['UTC'] }] },
  GMT: { meanings: [{ label: 'Greenwich Mean Time (UTC+00:00)', zones: ['UTC', 'Europe/London'] }], note: 'London observes GMT only in winter.' },
  PT: { meanings: [{ label: 'US Pacific Time', zones: ['America/Los_Angeles'] }] },
  PST: { meanings: [{ label: 'Pacific Standard Time', zones: ['America/Los_Angeles'] }] },
  PDT: { meanings: [{ label: 'Pacific Daylight Time', zones: ['America/Los_Angeles'] }] },
  MT: { meanings: [{ label: 'US Mountain Time', zones: ['America/Denver', 'America/Phoenix'] }], note: 'Arizona (America/Phoenix) stays on MST all year.' },
  MST: { meanings: [{ label: 'Mountain Standard Time', zones: ['America/Denver', 'America/Phoenix'] }], note: 'Arizona (America/Phoenix) stays on MST all year.' },
  MDT: { meanings: [{ label: 'Mountain Daylight Time', zones: ['America/Denver'] }] },
  CT: { meanings: [{ label: 'US Central Time', zones: ['America/Chicago'] }] },
  CST: {
    meanings: [
      { label: 'Central Standard Time (North America, UTC−06:00)', zones: ['America/Chicago', 'America/Mexico_City'] },
      { label: 'China Standard Time (UTC+08:00)', zones: ['Asia/Shanghai'] },
      { label: 'Cuba Standard Time (UTC−05:00)', zones: ['America/Havana'] },
    ],
  },
  CDT: { meanings: [{ label: 'Central Daylight Time', zones: ['America/Chicago'] }] },
  ET: { meanings: [{ label: 'US Eastern Time', zones: ['America/New_York', 'America/Toronto'] }] },
  EST: { meanings: [{ label: 'Eastern Standard Time', zones: ['America/New_York', 'America/Toronto'] }] },
  EDT: { meanings: [{ label: 'Eastern Daylight Time', zones: ['America/New_York', 'America/Toronto'] }] },
  AKST: { meanings: [{ label: 'Alaska Standard Time', zones: ['America/Anchorage'] }] },
  HST: { meanings: [{ label: 'Hawaii Standard Time', zones: ['Pacific/Honolulu'] }] },
  AST: {
    meanings: [
      { label: 'Atlantic Standard Time (UTC−04:00)', zones: ['America/Halifax', 'America/Puerto_Rico'] },
      { label: 'Arabia Standard Time (UTC+03:00)', zones: ['Asia/Riyadh', 'Asia/Baghdad'] },
    ],
  },
  NST: { meanings: [{ label: 'Newfoundland Standard Time', zones: ['America/St_Johns'] }] },
  BST: {
    meanings: [
      { label: 'British Summer Time (UTC+01:00)', zones: ['Europe/London'] },
      { label: 'Bangladesh Standard Time (UTC+06:00)', zones: ['Asia/Dhaka'] },
    ],
  },
  IST: {
    meanings: [
      { label: 'India Standard Time (UTC+05:30)', zones: ['Asia/Kolkata'] },
      { label: 'Irish Standard Time (UTC+01:00, summer)', zones: ['Europe/Dublin'] },
      { label: 'Israel Standard Time (UTC+02:00)', zones: ['Asia/Jerusalem'] },
    ],
  },
  WET: { meanings: [{ label: 'Western European Time', zones: ['Europe/Lisbon', 'Atlantic/Canary'] }] },
  CET: { meanings: [{ label: 'Central European Time', zones: ['Europe/Berlin', 'Europe/Paris', 'Europe/Madrid', 'Europe/Rome', 'Europe/Amsterdam', 'Europe/Warsaw'] }] },
  CEST: { meanings: [{ label: 'Central European Summer Time', zones: ['Europe/Berlin', 'Europe/Paris', 'Europe/Madrid', 'Europe/Rome', 'Europe/Amsterdam', 'Europe/Warsaw'] }] },
  EET: { meanings: [{ label: 'Eastern European Time', zones: ['Europe/Athens', 'Europe/Helsinki', 'Europe/Kyiv', 'Europe/Bucharest'] }] },
  EEST: { meanings: [{ label: 'Eastern European Summer Time', zones: ['Europe/Athens', 'Europe/Helsinki', 'Europe/Kyiv', 'Europe/Bucharest'] }] },
  MSK: { meanings: [{ label: 'Moscow Time', zones: ['Europe/Moscow'] }] },
  GST: {
    meanings: [
      { label: 'Gulf Standard Time (UTC+04:00)', zones: ['Asia/Dubai'] },
      { label: 'South Georgia Time (UTC−02:00)', zones: ['Atlantic/South_Georgia'] },
    ],
  },
  PKT: { meanings: [{ label: 'Pakistan Standard Time', zones: ['Asia/Karachi'] }] },
  NPT: { meanings: [{ label: 'Nepal Time', zones: ['Asia/Kathmandu'] }] },
  ICT: { meanings: [{ label: 'Indochina Time', zones: ['Asia/Bangkok', 'Asia/Ho_Chi_Minh'] }] },
  WIB: { meanings: [{ label: 'Western Indonesia Time', zones: ['Asia/Jakarta'] }] },
  SGT: { meanings: [{ label: 'Singapore Time', zones: ['Asia/Singapore'] }] },
  HKT: { meanings: [{ label: 'Hong Kong Time', zones: ['Asia/Hong_Kong'] }] },
  JST: { meanings: [{ label: 'Japan Standard Time', zones: ['Asia/Tokyo'] }] },
  KST: { meanings: [{ label: 'Korea Standard Time', zones: ['Asia/Seoul'] }] },
  AEST: { meanings: [{ label: 'Australian Eastern Standard Time', zones: ['Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane'] }], note: 'Brisbane (Queensland) stays on AEST all year.' },
  AEDT: { meanings: [{ label: 'Australian Eastern Daylight Time', zones: ['Australia/Sydney', 'Australia/Melbourne'] }] },
  ACST: { meanings: [{ label: 'Australian Central Standard Time', zones: ['Australia/Adelaide', 'Australia/Darwin'] }], note: 'Darwin stays on ACST all year.' },
  AWST: { meanings: [{ label: 'Australian Western Standard Time', zones: ['Australia/Perth'] }] },
  LHST: { meanings: [{ label: 'Lord Howe Standard Time', zones: ['Australia/Lord_Howe'] }] },
  NZST: { meanings: [{ label: 'New Zealand Standard Time', zones: ['Pacific/Auckland'] }] },
  NZDT: { meanings: [{ label: 'New Zealand Daylight Time', zones: ['Pacific/Auckland'] }] },
  SAST: { meanings: [{ label: 'South African Standard Time', zones: ['Africa/Johannesburg'] }] },
  EAT: { meanings: [{ label: 'East Africa Time', zones: ['Africa/Nairobi'] }] },
  WAT: { meanings: [{ label: 'West Africa Time', zones: ['Africa/Lagos'] }] },
  CAT: { meanings: [{ label: 'Central Africa Time', zones: ['Africa/Maputo'] }] },
  BRT: { meanings: [{ label: 'Brasília Time', zones: ['America/Sao_Paulo'] }] },
  ART: { meanings: [{ label: 'Argentina Time', zones: ['America/Argentina/Buenos_Aires'] }] },
}

/** Every zone, with renamed ids shown under their current name. */
export function zoneList(supported?: string[]): string[] {
  const raw = supported ?? (Intl as SupportedValues).supportedValuesOf?.('timeZone') ?? []
  const set = new Set(raw.map((zone) => RENAMED[zone] ?? zone))
  set.add('UTC')
  return [...set].sort()
}

/**
 * The catalog spelling of a zone from outside (a share link): any case, and
 * an alias (US/Pacific, Asia/Katmandu) mapped onto the zone it names where
 * the engine resolves it. Null for a zone the engine does not know.
 */
export function canonicalZone(zone: string, all: readonly string[] = zoneList()): string | null {
  let resolved: string
  try {
    resolved = new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone
  } catch {
    return null
  }
  const find = (name: string) => all.find((z) => z.toLowerCase() === name.toLowerCase())
  const renamed = (name: string) => RENAMED[name] ?? name
  return find(renamed(zone)) ?? find(renamed(resolved)) ?? renamed(resolved)
}

export function zoneCity(zone: string): string {
  return zone.slice(zone.lastIndexOf('/') + 1).replace(/_/g, ' ')
}

export interface SearchResult {
  zones: string[]
  abbreviation?: { abbr: string, ambiguous: boolean, entry: Abbreviation }
}

const norm = (s: string) => s.toLowerCase().replace(/[_\s]+/g, ' ').trim()

export function searchZones(query: string, all: string[], limit = 12): SearchResult {
  const q = norm(query)
  if (!q) return { zones: all.slice(0, limit) }
  const scored = new Map<string, number>()
  const add = (zone: string, score: number) => {
    const best = scored.get(zone)
    if (best === undefined || score < best) scored.set(zone, score)
  }

  const abbr = query.trim().toUpperCase()
  const entry = ABBREVIATIONS[abbr]
  let abbreviation: SearchResult['abbreviation']
  if (entry) {
    abbreviation = { abbr, ambiguous: entry.meanings.length > 1, entry }
    entry.meanings.forEach((meaning, i) => meaning.zones.forEach((zone, j) => add(zone, -100 + i * 10 + j)))
  }

  for (const zone of all) {
    const id = norm(zone)
    const city = norm(zoneCity(zone))
    if (city === q) add(zone, 0)
    else if (city.startsWith(q)) add(zone, 1)
    else if (id.includes(q)) add(zone, 3)
    const old = OLD_NAME[zone]
    if (old && norm(old).includes(q)) add(zone, 2)
    for (const name of CITIES[zone] ?? []) {
      const n = norm(name)
      if (n === q) add(zone, 0)
      else if (n.startsWith(q)) add(zone, 2)
    }
  }
  const zones = [...scored.entries()]
    .filter(([zone]) => all.includes(zone) || zone === 'UTC')
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([zone]) => zone)
    .slice(0, limit)
  return { zones, abbreviation }
}

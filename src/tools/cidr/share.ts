/**
 * The URL fragment: readable `key=value` pairs, like cron's `#e=` and dates'
 * `#zones=`. Addresses are not secrets, but the fragment still never reaches
 * a server. Only the open tab's fields are written, so a link is short and
 * opens where it was copied. Everything read back is clipped and checked.
 */

export type Tab = 'calc' | 'split' | 'summarise' | 'contains' | 'range'
export type SplitBy = 'count' | 'prefix'

export interface State {
  tab: Tab
  calc: string
  splitNet: string
  splitBy: SplitBy
  splitValue: string
  entries: string
  a: string
  b: string
  range: string
}

export const TABS: Tab[] = ['calc', 'split', 'summarise', 'contains', 'range']

export const DEFAULTS: State = {
  tab: 'calc',
  calc: '192.168.1.10/24',
  splitNet: '10.0.0.0/16',
  splitBy: 'prefix',
  splitValue: '24',
  entries: '10.0.0.0/25\n10.0.0.128/25\n10.0.1.0/24\n10.0.2.0/24\n192.168.0.0/24\n192.168.1.0/24\n2001:db8::/33\n2001:db8:8000::/33',
  a: '10.1.2.3',
  b: '10.0.0.0/8',
  range: '192.0.2.10 - 192.0.2.99',
}

/** Field length caps: a field is one address expression; the list is a block. */
export const FIELD_MAX = 200
export const LIST_MAX = 4000

const KEYS: Record<Tab, (keyof State)[]> = {
  calc: ['calc'],
  split: ['splitNet', 'splitBy', 'splitValue'],
  summarise: ['entries'],
  contains: ['a', 'b'],
  range: ['range'],
}

const SHORT: Partial<Record<keyof State, string>> = {
  calc: 'q', splitNet: 'n', splitBy: 'by', splitValue: 'v', entries: 'l', a: 'a', b: 'b', range: 'r',
}

export function readFragment(hash: string): State {
  const state: State = { ...DEFAULTS }
  if (!hash.startsWith('#')) return state
  let params: URLSearchParams
  try { params = new URLSearchParams(hash.slice(1)) } catch { return state }
  const tab = params.get('t')
  if (!tab || !(TABS as string[]).includes(tab)) return state
  state.tab = tab as Tab
  for (const key of KEYS[state.tab]) {
    const value = params.get(SHORT[key]!)
    if (value === null) continue
    if (key === 'splitBy') {
      if (value === 'count' || value === 'prefix') state.splitBy = value
    } else if (key === 'entries') {
      state.entries = value.slice(0, LIST_MAX)
    } else {
      (state[key] as string) = value.replace(/[\r\n]+/g, ' ').slice(0, FIELD_MAX)
    }
  }
  return state
}

/** The fragment for the open tab; `omitted` when the list was too long to include. */
export function writeFragment(state: State): { hash: string; omitted: boolean } {
  const pairs = [`t=${state.tab}`]
  let omitted = false
  for (const key of KEYS[state.tab]) {
    const value = String(state[key])
    if (key === 'entries' && value.length > LIST_MAX) { omitted = true; continue }
    pairs.push(`${SHORT[key]!}=${encode(value)}`)
  }
  return { hash: `#${pairs.join('&')}`, omitted }
}

/** encodeURIComponent, but "/" and ":" stay readable — both are legal in a fragment. */
function encode(value: string): string {
  return encodeURIComponent(value).replace(/%2F/gi, '/').replace(/%3A/gi, ':')
}

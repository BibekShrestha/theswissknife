/**
 * The URL fragment, readable like the land tool's: `#d=2082-07-08` for the
 * converter, `#t=math&a=…&b=…&s=…&o=add&n=90&u=days` for date math. Dates
 * travel as BS; anything that does not read back falls to the defaults.
 */

import { bsToDay, dayToBs, FIRST_DAY, inRange, isoDate, LAST_DAY } from './calendar'

export type Tab = 'convert' | 'math'
export type Unit = 'days' | 'weeks' | 'months' | 'years'
export const UNITS: Unit[] = ['days', 'weeks', 'months', 'years']

export interface State {
  tab: Tab
  /** The converter's date, as a day number. */
  date: number
  from: number
  to: number
  base: number
  op: 'add' | 'sub'
  amount: string
  unit: Unit
}

/** Today, or the nearest covered day when today is outside the table. */
export const clampDay = (n: number) => Math.min(Math.max(n, FIRST_DAY), LAST_DAY)

export function defaults(today: number): State {
  const day = clampDay(today)
  return { tab: 'convert', date: day, from: day, to: clampDay(day + 90), base: day, op: 'add', amount: '90', unit: 'days' }
}

function readDay(text: string | null): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text ?? '')
  return m ? bsToDay({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }) : null
}

const bsText = (n: number) => (inRange(n) ? isoDate(dayToBs(n)!) : '')

export function readFragment(hash: string, today: number): State {
  const state = defaults(today)
  let params: URLSearchParams
  try { params = new URLSearchParams(hash.replace(/^#/, '')) } catch { return state }
  if (params.has('d')) return { ...state, date: readDay(params.get('d')) ?? state.date }
  if (params.get('t') !== 'math') return state
  const unit = params.get('u') as Unit
  const amount = params.get('n') ?? ''
  return {
    ...state,
    tab: 'math',
    from: readDay(params.get('a')) ?? state.from,
    to: readDay(params.get('b')) ?? state.to,
    base: readDay(params.get('s')) ?? state.base,
    op: params.get('o') === 'sub' ? 'sub' : 'add',
    amount: /^\d{1,6}$/.test(amount) ? amount : state.amount,
    unit: UNITS.includes(unit) ? unit : state.unit,
  }
}

export function writeFragment(state: State): string {
  if (state.tab === 'convert') return `#d=${bsText(state.date)}`
  const params = new URLSearchParams({ t: 'math', a: bsText(state.from), b: bsText(state.to), s: bsText(state.base), o: state.op, n: state.amount.trim(), u: state.unit })
  return `#${params.toString()}`
}

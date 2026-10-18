import type { CronExpression, FieldPart, ParsedField } from './parse'

/** Plain-English description of a parsed cron expression. */

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const pad = (n: number) => String(n).padStart(2, '0')
const clock = (h: number, m: number) => `${pad(h)}:${pad(m)}`

export function joinList(items: string[], word = 'and'): string {
  if (items.length <= 1) return items.join('')
  if (items.length === 2) return `${items[0]} ${word} ${items[1]}`
  return `${items.slice(0, -1).join(', ')} ${word} ${items[items.length - 1]}`
}

function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/** Single values only (no ranges, no steps, no `*`). */
function singles(field: ParsedField): number[] | null {
  return field.parts.every((p) => p.start !== null && p.start === p.end && !p.openEnded) ? field.values : null
}

/**
 * A field that is exactly `*\/n` (the only part) where n divides the range,
 * so the gap is n all the way round. `*\/7` in minutes hits :56 and then :00,
 * four minutes later — that is not "every 7 minutes"; see unevenStep.
 */
function everyStep(field: ParsedField, mustDivide = true): number | null {
  const [p] = field.parts
  const span = field.spec.max - field.spec.min + 1
  return field.parts.length === 1 && p.start === null && p.step > 1 && (!mustDivide || span % p.step === 0) ? p.step : null
}

/** `*\/n` where n does not divide the range: the values it hits. */
function unevenStep(field: ParsedField): number[] | null {
  const [p] = field.parts
  return field.parts.length === 1 && p.start === null && p.step > 1 && !everyStep(field) ? field.values : null
}

/** Up to six values in full, otherwise the first three and the last. */
function valueList(values: string[]): string {
  return values.length <= 6 ? joinList(values) : `${values.slice(0, 3).join(', ')}, …, ${values[values.length - 1]}`
}

/** A field that is exactly one plain range a-b. */
function plainRange(field: ParsedField): [number, number] | null {
  const [p] = field.parts
  return field.parts.length === 1 && p.start !== null && p.end !== null && p.start !== p.end && p.step === 1 ? [p.start, p.end] : null
}

function minutePhrase(field: ParsedField): string {
  if (field.all) return 'Every minute'
  const step = everyStep(field)
  if (step) return `Every ${step} minutes`
  const uneven = unevenStep(field)
  if (uneven) return `At minutes ${valueList(uneven.map(String))} past the hour`
  const one = singles(field)
  if (one) return `At minute${one.length > 1 ? 's' : ''} ${joinList(one.map(String))} past the hour`
  return `At ${joinList(field.parts.map((p) => partText(p, field, 'minute')))} past the hour`
}

function hourPhrase(field: ParsedField): string {
  if (field.all) return ''
  const step = everyStep(field)
  if (step) return `every ${step} hours`
  const uneven = unevenStep(field)
  if (uneven) return `during the ${valueList(uneven.map((h) => clock(h, 0)))} hours`
  const range = plainRange(field)
  if (range) return `between ${clock(range[0], 0)} and ${clock(range[1], 59)}`
  const one = singles(field)
  if (one) return `during the ${joinList(one.map((h) => clock(h, 0)))} hour${one.length > 1 ? 's' : ''}`
  return `during hours ${joinList(field.parts.map((p) => partText(p, field, 'hour')))}`
}

/** Generic wording for one comma element. */
function partText(p: FieldPart, field: ParsedField, unit: 'minute' | 'hour' | 'day'): string {
  const show = (v: number) => (unit === 'hour' ? clock(v, 0) : String(v))
  if (p.start === null) return p.step > 1 ? `every ${ordinal(p.step)} ${unit}` : `every ${unit}`
  if (p.start === p.end && !p.openEnded) return show(p.start)
  const end = p.end ?? field.spec.max
  if (p.step === 1) return `${show(p.start)} through ${show(end)}`
  return `every ${ordinal(p.step)} ${unit} from ${show(p.start)} through ${show(end)}`
}

function nameList(values: number[], names: string[], offset: number): string {
  // Collapse consecutive runs of 3+ into "A through B".
  const groups: string[] = []
  let i = 0
  while (i < values.length) {
    let j = i
    while (j + 1 < values.length && values[j + 1] === values[j] + 1) j++
    if (j - i >= 2) groups.push(`${names[values[i] - offset]} through ${names[values[j] - offset]}`)
    else for (let k = i; k <= j; k++) groups.push(names[values[k] - offset])
    i = j + 1
  }
  return joinList(groups)
}

function domPhrase(field: ParsedField): string {
  // Months differ in length anyway; the wording says the count restarts on the 1st.
  const step = everyStep(field, false)
  if (step) return `every ${ordinal(step)} day of the month (from the 1st)`
  const range = plainRange(field)
  if (range) return `on days ${range[0]} through ${range[1]} of the month`
  const one = singles(field)
  if (one) return `on day${one.length > 1 ? 's' : ''} ${joinList(one.map(String))} of the month`
  return `on days ${joinList(field.parts.map((p) => partText(p, field, 'day')))} of the month`
}

function dowPhrase(field: ParsedField): string {
  const text = nameList(field.values, DAY_NAMES, 0)
  return plainRange(field) && field.values.length >= 3 ? text : `on ${text}`
}

function monthPhrase(field: ParsedField): string {
  return `in ${nameList(field.values, MONTH_NAMES, 1)}`
}

function timePhrase(cron: CronExpression): string {
  const mins = singles(cron.minute)
  const hrs = cron.hour.values
  if (mins && !cron.hour.all && mins.length * hrs.length <= 6) {
    const times: string[] = []
    for (const h of hrs) for (const m of mins) times.push(clock(h, m))
    return `At ${joinList(times)}`
  }
  const onTheHour = mins?.length === 1 && mins[0] === 0
  if (mins && cron.hour.all) {
    if (onTheHour) return 'Every hour, on the hour'
    return `At minute${mins.length > 1 ? 's' : ''} ${joinList(mins.map(String))} past every hour`
  }
  const minute = onTheHour ? 'On the hour' : minutePhrase(cron.minute)
  const hour = hourPhrase(cron.hour)
  return hour ? `${minute}, ${hour}` : minute
}

function dayPhrase(cron: CronExpression): string {
  const { dayOfMonth: dom, dayOfWeek: dow } = cron
  const domAll = dom.all
  const dowAll = dow.all
  if (cron.dayOr) {
    // Both restricted: Vixie runs on a day matching either.
    return `${domPhrase(dom)}, or ${dowPhrase(dow)}`
  }
  if (domAll && dowAll) return ''
  if (dowAll) return domPhrase(dom)
  if (domAll) return dowPhrase(dow)
  // One field starts with `*` (e.g. */2) but is still restrictive: both must match.
  return `${domPhrase(dom)}, if it is also ${nameList(dow.values, DAY_NAMES, 0)}`
}

export function describeCron(cron: CronExpression): string {
  const pieces = [timePhrase(cron)]
  const days = dayPhrase(cron)
  if (days) pieces.push(days)
  if (!cron.month.all) pieces.push(monthPhrase(cron.month))
  return pieces.join(', ')
}

/** Short summary of one field for the field-breakdown grid. */
export function describeField(field: ParsedField): string {
  if (field.all) return `every ${field.spec.label.toLowerCase()}`
  switch (field.spec.name) {
    case 'month':
      return nameList(field.values, MONTH_NAMES, 1)
    case 'dayOfWeek':
      return nameList(field.values, DAY_NAMES, 0)
    case 'hour':
      return field.values.length <= 6 ? joinList(field.values.map((h) => clock(h, 0))) : `${field.values.length} hours`
    default:
      return field.values.length <= 8 ? joinList(field.values.map(String)) : `${field.values.length} values`
  }
}

import { describe, expect, it } from 'vitest'
import { describeCron } from './describe'
import { parseCron } from './parse'

function text(expr: string): string {
  const result = parseCron(expr)
  if (!result.ok) throw new Error(result.error.message)
  return describeCron(result.cron)
}

describe('describeCron', () => {
  it.each([
    ['* * * * *', 'Every minute'],
    ['*/15 9-17 * * 1-5', 'Every 15 minutes, between 09:00 and 17:59, Monday through Friday'],
    ['0 9 * * *', 'At 09:00'],
    ['30 9,17 * * *', 'At 09:30 and 17:30'],
    ['0 * * * *', 'Every hour, on the hour'],
    ['15 * * * *', 'At minute 15 past every hour'],
    ['0 */6 * * *', 'At 00:00, 06:00, 12:00 and 18:00'],
    ['0 */2 * * *', 'On the hour, every 2 hours'],
    ['0 9-17 * * 1-5', 'On the hour, between 09:00 and 17:59, Monday through Friday'],
    ['5 */2 * * *', 'At minute 5 past the hour, every 2 hours'],
    ['0 0,6,12,18 * * *', 'At 00:00, 06:00, 12:00 and 18:00'],
    ['0 0 1 * *', 'At 00:00, on day 1 of the month'],
    ['0 0 1 1 *', 'At 00:00, on day 1 of the month, in January'],
    ['0 0 * * 0', 'At 00:00, on Sunday'],
    ['0 0 * * 6,0', 'At 00:00, on Sunday and Saturday'],
    ['0 12 * */3 *', 'At 12:00, in January, April, July and October'],
    ['0 0 1,15 * MON', 'At 00:00, on days 1 and 15 of the month, or on Monday'],
    ['0 0 */2 * 1', 'At 00:00, every 2nd day of the month (from the 1st), if it is also Monday'],
    ['1-30/5 * * * *', 'At every 5th minute from 1 through 30 past the hour'],
    ['0 8 1-7 * *', 'At 08:00, on days 1 through 7 of the month'],
    ['0 0 * JUN-AUG *', 'At 00:00, in June through August'],
  ])('%s', (expr, expected) => {
    expect(text(expr)).toBe(expected)
  })

  it.each([
    ['*/7 * * * *', 'At minutes 0, 7, 14, …, 56 past the hour'],
    ['*/25 * * * *', 'At minutes 0, 25 and 50 past the hour'],
    ['*/15 */5 * * *', 'Every 15 minutes, during the 00:00, 05:00, 10:00, 15:00 and 20:00 hours'],
    ['*/20 */6 * * *', 'Every 20 minutes, every 6 hours'],
  ])('describes uneven steps by the values they hit (CRON-3): %s', (expr, expected) => {
    expect(text(expr)).toBe(expected)
  })

  it('describes macros by their expansion', () => {
    expect(text('@hourly')).toBe('Every hour, on the hour')
    expect(text('@weekly')).toBe('At 00:00, on Sunday')
  })
})

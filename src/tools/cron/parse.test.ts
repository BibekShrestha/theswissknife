import { describe, expect, it } from 'vitest'
import { parseCron, type CronExpression } from './parse'

function ok(expr: string): CronExpression {
  const result = parseCron(expr)
  if (!result.ok) throw new Error(result.error.message)
  return result.cron
}

function err(expr: string) {
  const result = parseCron(expr)
  if (result.ok) throw new Error(`expected "${expr}" to fail`)
  return result.error
}

describe('parseCron', () => {
  it('expands *, lists, ranges and steps', () => {
    const cron = ok('*/15 9-17 1,15 * 1-5')
    expect(cron.minute.values).toEqual([0, 15, 30, 45])
    expect(cron.hour.values).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17])
    expect(cron.dayOfMonth.values).toEqual([1, 15])
    expect(cron.month.all).toBe(true)
    expect(cron.dayOfWeek.values).toEqual([1, 2, 3, 4, 5])
  })

  it('handles stepped ranges and n/step', () => {
    expect(ok('1-30/5 * * * *').minute.values).toEqual([1, 6, 11, 16, 21, 26])
    expect(ok('50/5 * * * *').minute.values).toEqual([50, 55])
    expect(ok('0 */7 * * *').hour.values).toEqual([0, 7, 14, 21])
  })

  it('accepts month and day names in any case, in ranges and lists', () => {
    expect(ok('0 0 * jan-mar,DEC *').month.values).toEqual([1, 2, 3, 12])
    expect(ok('0 0 * * Mon-Fri').dayOfWeek.values).toEqual([1, 2, 3, 4, 5])
    expect(ok('0 0 * * SUN').dayOfWeek.values).toEqual([0])
  })

  it('treats day-of-week 0 and 7 as Sunday', () => {
    expect(ok('0 0 * * 7').dayOfWeek.values).toEqual([0])
    expect(ok('0 0 * * 5-7').dayOfWeek.values).toEqual([0, 5, 6])
    expect(ok('0 0 * * 0-7').dayOfWeek.all).toBe(true)
  })

  it('expands macros', () => {
    expect(ok('@yearly').normalized).toBe('0 0 1 1 *')
    expect(ok('@annually').normalized).toBe('0 0 1 1 *')
    expect(ok('@monthly').normalized).toBe('0 0 1 * *')
    expect(ok('@weekly').normalized).toBe('0 0 * * 0')
    expect(ok('@daily').normalized).toBe('0 0 * * *')
    expect(ok('@MIDNIGHT').normalized).toBe('0 0 * * *')
    expect(ok('@hourly').normalized).toBe('0 * * * *')
    expect(ok('@daily').macro).toBe('@daily')
  })

  it('tolerates extra whitespace', () => {
    expect(ok('  0\t9  * *   1 ').normalized).toBe('0 9 * * 1')
  })

  it('applies the Vixie day rule only when neither day field starts with *', () => {
    expect(ok('0 0 1 * 1').dayOr).toBe(true)
    expect(ok('0 0 * * 1').dayOr).toBe(false)
    expect(ok('0 0 1 * *').dayOr).toBe(false)
    // */2 counts as a star field in Vixie cron, so the fields AND.
    expect(ok('0 0 */2 * 1').dayOr).toBe(false)
  })
})

describe('parse errors', () => {
  it('rejects a seconds field clearly', () => {
    const e = err('0 */5 * * * *')
    expect(e.field).toBeNull()
    expect(e.message).toMatch(/6 fields/)
    expect(e.message).toMatch(/seconds field/)
    expect(err('0 0 12 * * ? 2025').message).toMatch(/7 fields.*year/)
  })

  it('reports too few fields', () => {
    expect(err('* * *').message).toMatch(/Got 3 fields, expected 5/)
    expect(err('').message).toMatch(/Enter a cron expression/)
  })

  it('names the field and the reason', () => {
    expect(err('60 * * * *')).toEqual({ field: 0, message: 'Minute field "60": 60 is out of range (0–59)' })
    expect(err('0 24 * * *').field).toBe(1)
    expect(err('0 0 0 * *').message).toMatch(/Day of month field "0": 0 is out of range \(1–31\)/)
    expect(err('0 0 * 13 *').message).toMatch(/Month field "13"/)
    expect(err('0 0 * * 8').message).toMatch(/Day of week field "8": 8 is out of range \(0–7\)/)
  })

  it('explains bad ranges, steps and names', () => {
    expect(err('30-5 * * * *').message).toMatch(/runs backwards/)
    expect(err('*/0 * * * *').message).toMatch(/step 0/)
    expect(err('*/x * * * *').message).toMatch(/positive whole number/)
    expect(err('1,,2 * * * *').message).toMatch(/stray comma/)
    expect(err('0 0 * FOO *').message).toMatch(/not a month name/)
    expect(err('0 0 * * FUNDAY').message).toMatch(/not a day name/)
    expect(err('0 0 L * *').message).toMatch(/Quartz/)
    expect(err('0 0 * * 5#2').message).toMatch(/Quartz/)
    expect(err('0 0 ? * *').message).toMatch(/Quartz/)
  })

  it('gives the Quartz message for L, W and ? in the name fields too (CRON-4)', () => {
    expect(err('0 0 * * L').message).toMatch(/Quartz/)
    expect(err('0 0 * * 5L').message).toMatch(/Quartz/)
    expect(err('0 0 * * ?').message).toMatch(/Quartz/)
    expect(err('0 0 * L *').message).toMatch(/Quartz/)
    // Real names that start with W or end in L still parse.
    expect(ok('0 0 * JUL WED').dayOfWeek.values).toEqual([3])
    expect(ok('0 0 * JUL WED').month.values).toEqual([7])
    expect(err('0 0 * * MON-').message).toMatch(/missing its end/)
    expect(err('-5 * * * *').message).toMatch(/negative/)
    expect(err('1-2-3 * * * *').message).toMatch(/not a valid range/)
  })

  it('rejects unknown macros and @reboot', () => {
    expect(err('@often').message).toMatch(/Unknown macro/)
    expect(err('@reboot').message).toMatch(/not on a schedule/)
  })
})

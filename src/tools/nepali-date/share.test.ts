import { describe, expect, it } from 'vitest'
import { bsToDay, LAST_DAY } from './calendar'
import { defaults, readFragment, writeFragment } from './share'

const today = bsToDay({ year: 2083, month: 7, day: 8 })!

describe('fragment', () => {
  it('round-trips both tabs', () => {
    const convert = { ...defaults(today), date: bsToDay({ year: 2062, month: 2, day: 1 })! }
    expect(writeFragment(convert)).toBe('#d=2062-02-01')
    expect(readFragment('#d=2062-02-01', today)).toEqual(convert)

    const math = { ...defaults(today), tab: 'math' as const, op: 'sub' as const, amount: '35', unit: 'months' as const }
    expect(readFragment(writeFragment(math), today)).toEqual(math)
  })

  it('falls back to the defaults on anything odd', () => {
    expect(readFragment('', today)).toEqual(defaults(today))
    expect(readFragment('#d=2084-01-01', today)).toEqual(defaults(today))
    expect(readFragment('#d=2082-07-31', today)).toEqual(defaults(today))
    expect(readFragment('#t=math&n=-5&u=hours&o=x', today)).toEqual({ ...defaults(today), tab: 'math' })
  })

  it('keeps today inside the table', () => {
    expect(defaults(LAST_DAY + 400).date).toBe(LAST_DAY)
  })
})

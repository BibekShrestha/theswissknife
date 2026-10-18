import { describe, expect, it } from 'vitest'
import { nextRuns } from './next'
import { parseCron } from './parse'
import { zoneOptions } from './zones'

describe('time zone choices (CRON-1)', () => {
  it('offers UTC even when Intl.supportedValuesOf leaves it out', () => {
    expect(zoneOptions(['Africa/Abidjan', 'Europe/Paris'], 'Europe/Paris')).toEqual(['UTC', 'Africa/Abidjan', 'Europe/Paris'])
    expect(zoneOptions(['Europe/Paris'], 'Asia/Unknown_Local')).toEqual(['UTC', 'Asia/Unknown_Local', 'Europe/Paris'])
    expect(zoneOptions(undefined, 'UTC')).toEqual(['UTC'])
  })

  it('computes runs in UTC', () => {
    const parsed = parseCron('0 9 * * *')
    if (!parsed.ok) throw new Error(parsed.error.message)
    const run = nextRuns(parsed.cron, 'UTC', Date.parse('2026-06-01T00:00:00Z'), 1).runs[0]
    expect(new Date(run.at).toISOString()).toBe('2026-06-01T09:00:00.000Z')
    expect(run.offsetMinutes).toBe(0)
  })
})

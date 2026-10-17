import { describe, expect, it } from 'vitest'
import { durationsHash, plannerHash, readHash } from './share'

describe('fragment state', () => {
  it('round-trips the planner', () => {
    const state = { zones: ['Europe/London', 'America/New_York', 'Asia/Kathmandu'], date: '2026-03-29', work: [9, 17] as [number, number], sel: [36, 40] as [number, number], len: 60 }
    const hash = plannerHash(state)
    expect(hash).toBe('#zones=Europe/London,America/New_York,Asia/Kathmandu&date=2026-03-29&work=9-17&len=60&sel=36-40')
    expect(readHash(hash)).toEqual({ tab: 'zones', planner: state })
  })

  it('round-trips durations', () => {
    const state = {
      start: '2026-03-07T09:00', startZone: 'America/New_York', end: '2026-03-08T09:00:30', endZone: 'Europe/London',
      iso: '-P1M', base: '2026-01-31T10:00', baseZone: 'UTC', op: 'sub' as const,
    }
    expect(readHash(durationsHash(state))).toEqual({ tab: 'durations', durations: state })
  })

  it('drops invalid values', () => {
    expect(readHash('#zones=Mars/Base,UTC&date=2026-02-30&work=9-99&sel=5-2&len=7')).toEqual({ tab: 'zones', planner: { zones: ['UTC'] } })
    expect(readHash('#d=yesterday&dz=Nowhere&op=mul')).toEqual({ tab: 'durations', durations: {} })
    expect(readHash('#something=else')).toEqual({ tab: null })
    expect(readHash('')).toEqual({ tab: null })
  })
})

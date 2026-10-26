import { describe, expect, it } from 'vitest'
import { DEFAULTS, readFragment, writeFragment, type State } from './share'

describe('share fragment', () => {
  it('round-trips both kinds of point', () => {
    const grid: State = { input: 'grid', zone: 87, e: '630391.974', n: '3066418.735', lat: '', lon: '', shift: 'none' }
    expect(writeFragment(grid)).toBe('#i=grid&z=87&e=630391.974&n=3066418.735&s=none')
    expect(readFragment(writeFragment(grid))).toEqual(grid)
    const geo: State = { input: 'geo', zone: 'auto', e: '', n: '', lat: `27°42'36.5"N`, lon: '85.324', shift: 'epsg6208' }
    expect(readFragment(writeFragment(geo))).toEqual(geo)
  })

  it('writes Devanagari digits as ASCII', () => {
    expect(writeFragment({ ...DEFAULTS, lat: '२७.५' })).toContain('lat=27.5')
  })

  it('falls back to the defaults on anything odd', () => {
    expect(readFragment('')).toEqual(DEFAULTS)
    expect(readFragment('#m=hill')).toEqual(DEFAULTS)
    expect(readFragment('#i=grid&z=auto&e=1&n=2')).toEqual(DEFAULTS)
    expect(readFragment('#i=grid&z=85&e=1&n=2')).toEqual(DEFAULTS)
    expect(readFragment('#i=geo&z=84&lat=<script>&lon=1')).toEqual(DEFAULTS)
    expect(readFragment('#i=geo&z=84&lat=1&lon=1&s=nad27')).toEqual(DEFAULTS)
    expect(readFragment(`#i=grid&z=84&e=${'1'.repeat(30)}&n=2`)).toEqual(DEFAULTS)
  })
})

import { describe, expect, it } from 'vitest'
import { formatDms, parseAngle, parsePair } from './angle'

const value = (text: string, kind?: 'lat' | 'lon') => {
  const r = parseAngle(text, kind)
  if (!r.ok) throw new Error(r.error)
  return r.value
}
const error = (text: string, kind?: 'lat' | 'lon') => {
  const r = parseAngle(text, kind)
  return r.ok ? null : r.error
}

describe('parseAngle', () => {
  const dms = 27 + 42 / 60 + 36.5 / 3600

  it('reads decimal degrees', () => {
    expect(value('27.7172')).toBe(27.7172)
    expect(value(' -85.5 ')).toBe(-85.5)
    expect(value('+85.5')).toBe(85.5)
    expect(value('−12.5')).toBe(-12.5)
    expect(value('.5')).toBe(0.5)
  })

  it('reads DMS in the usual spellings', () => {
    for (const text of [`27°42'36.5"N`, '27 42 36.5', '27:42:36.5', '27d42m36.5s', '27º 42′ 36.5″ N', 'N 27°42’36.5”', '27°42\'36.5" n', '27d42m36.5sN', `27°42'36.5s`, '27°42′36.5s']) {
      expect(value(text), text).toBeCloseTo(dms, 12)
    }
    expect(value(`27°42.5'`)).toBeCloseTo(27 + 42.5 / 60, 12)
    expect(value('85 19 26 E', 'lon')).toBeCloseTo(85 + 19 / 60 + 26 / 3600, 12)
  })

  it('reads Devanagari digits', () => {
    expect(value('२७.७१७२')).toBe(27.7172)
    expect(value('२७°४२\'३६.५"N')).toBeCloseTo(dms, 12)
  })

  it('applies hemisphere letters and reports the axis they name', () => {
    expect(value('27.5S')).toBe(-27.5)
    expect(value('W 85.5')).toBe(-85.5)
    expect(parseAngle('85.5E')).toEqual({ ok: true, value: 85.5, kind: 'lon' })
    expect(parseAngle('27.5N')).toEqual({ ok: true, value: 27.5, kind: 'lat' })
    expect(parseAngle('27.5')).toEqual({ ok: true, value: 27.5 })
  })

  it('refuses what it cannot read, with a reason', () => {
    expect(error('')).toMatch(/Empty/)
    expect(error('abc')).toMatch(/not an angle/)
    expect(error('27.5E', 'lat')).toMatch(/N or S/)
    expect(error('85N', 'lon')).toMatch(/E or W/)
    expect(error('-27.5S')).toMatch(/not both/)
    expect(error('N27E')).toMatch(/once/)
    expect(error('27 60 0')).toMatch(/Minutes/)
    expect(error('27 30 60')).toMatch(/Seconds/)
    expect(error('27.5 30')).toMatch(/last part/)
    expect(error('27 30 15 5')).toMatch(/not an angle/)
    expect(error('91', 'lat')).toMatch(/Latitude/)
    expect(error('181', 'lon')).toMatch(/Longitude/)
    expect(error('27,5')).toMatch(/decimal point/)
    expect(error('x'.repeat(200))).toMatch(/Too long/)
  })

  it('never quotes much of its input', () => {
    const r = parseAngle('abcdefghijklmnopqrstuvwxyz0123')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.length).toBeLessThan(40)
  })
})

describe('formatDms', () => {
  it('prints degrees, minutes, seconds and hemisphere', () => {
    expect(formatDms(27 + 42 / 60 + 36.5 / 3600, 'lat')).toBe(`27°42'36.5000"N`)
    expect(formatDms(-(85 + 19 / 60 + 26 / 3600), 'lon')).toBe(`85°19'26.0000"W`)
    expect(formatDms(85.05, 'lon', 1)).toBe(`85°03'00.0"E`)
  })

  it('carries rounding into minutes and degrees', () => {
    expect(formatDms(27 + 59 / 60 + 59.99999 / 3600, 'lat')).toBe(`28°00'00.0000"N`)
  })

  it('round-trips through parseAngle', () => {
    for (const v of [26.4525, 28.9631, 30.4299999, 80.1816, 88.2]) {
      expect(value(formatDms(v, 'lat', 6))).toBeCloseTo(v, 9)
    }
  })
})

describe('parsePair', () => {
  it('reads a pasted pair in either order when letters say so', () => {
    expect(parsePair('27.7172, 85.3240')).toEqual({ lat: 27.7172, lon: 85.324 })
    expect(parsePair('27.7172 85.3240')).toEqual({ lat: 27.7172, lon: 85.324 })
    expect(parsePair(`85°19'E, 27°43'N`)).toEqual({ lat: 27 + 43 / 60, lon: 85 + 19 / 60 })
    expect(parsePair(`27°43'N 85°19'E`)).toEqual({ lat: 27 + 43 / 60, lon: 85 + 19 / 60 })
  })
  it('takes the larger number as longitude when there are no letters, like batch auto', () => {
    expect(parsePair('85.3240,27.7172')).toEqual({ lat: 27.7172, lon: 85.324 })
    expect(parsePair('85.3240 27.7172')).toEqual({ lat: 27.7172, lon: 85.324 })
    expect(parsePair(`27°43'N, 85.3240`)).toEqual({ lat: 27 + 43 / 60, lon: 85.324 })
  })
  it('returns null for anything else', () => {
    expect(parsePair('27.7172')).toBeNull()
    expect(parsePair('27 42 36')).toBeNull()
    expect(parsePair('a, b')).toBeNull()
  })
})

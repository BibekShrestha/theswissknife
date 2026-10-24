import { describe, expect, it } from 'vitest'
import { template } from './plot/model'
import { DEFAULTS, readFragment, writeFragment, type State } from './share'
import { div, formatQ, fromCompound, mul, parseCompound, parseDecimal, q, toCompound, UNIT, UNITS, type Q } from './units'

const dec = (s: string) => parseDecimal(s)!
const m2 = (value: string, unit: keyof typeof UNIT) => mul(dec(value), UNIT[unit].m2)
const inUnit = (area: Q, unit: keyof typeof UNIT, digits = 6) => formatQ(div(area, UNIT[unit].m2), digits, false)

describe('unit definitions', () => {
  it('are exact in square metres', () => {
    expect(formatQ(UNIT.ropani.m2, 8)).toBe('508.73704704')
    expect(formatQ(UNIT.aana.m2, 10)).toBe('31.79606544')
    expect(formatQ(UNIT.bigha.m2, 8)).toBe('6,772.631616')
    expect(formatQ(UNIT.kattha.m2, 8)).toBe('338.6315808')
    expect(formatQ(UNIT.dhur.m2, 8)).toBe('16.93157904')
    expect(formatQ(UNIT.acre.m2, 10)).toBe('4,046.8564224')
  })

  it('nest exactly: 16 aana, 4 paisa, 4 dam; 20 kattha, 20 dhur', () => {
    expect(mul(UNIT.aana.m2, q(16n))).toEqual(UNIT.ropani.m2)
    expect(mul(UNIT.paisa.m2, q(4n))).toEqual(UNIT.aana.m2)
    expect(mul(UNIT.dam.m2, q(4n))).toEqual(UNIT.paisa.m2)
    expect(mul(UNIT.kattha.m2, q(20n))).toEqual(UNIT.bigha.m2)
    expect(mul(UNIT.dhur.m2, q(20n))).toEqual(UNIT.kattha.m2)
  })

  it('relate the two systems as land offices quote them', () => {
    expect(inUnit(UNIT.bigha.m2, 'ropani', 4)).toBe('13.3126')
    expect(inUnit(UNIT.ropani.m2, 'kattha', 4)).toBe('1.5023')
    expect(inUnit(UNIT.ropani.m2, 'dhur', 4)).toBe('30.0466')
  })

  it('has a definition and a unique id for every unit', () => {
    expect(new Set(UNITS.map((u) => u.id)).size).toBe(UNITS.length)
    for (const u of UNITS) expect(u.definition).not.toBe('')
  })
})

describe('parseDecimal', () => {
  it('reads plain, grouped and Devanagari decimals exactly', () => {
    expect(dec('12')).toEqual(q(12n))
    expect(dec('0.25')).toEqual(q(1n, 4n))
    expect(dec('.5')).toEqual(q(1n, 2n))
    expect(dec('1,234.5')).toEqual(q(2469n, 2n))
    expect(dec('१२.५')).toEqual(q(25n, 2n))
    expect(dec('')).toEqual(q(0n))
  })

  it('refuses signs, exponents and words', () => {
    for (const bad of ['-1', '1e3', 'abc', '.', '1.2.3', '+4']) expect(parseDecimal(bad), bad).toBeNull()
  })
})

describe('compound forms', () => {
  it('splits into whole parts with the smallest rounded', () => {
    expect(toCompound(UNIT.bigha.m2, 'hill').text).toBe('13-5-0-0.04')
    expect(toCompound(UNIT.ropani.m2, 'terai').text).toBe('0-1-10.05')
    expect(toCompound(m2('1', 'm2'), 'hill').parts).toEqual(['0', '0', '0', '0.5'])
  })

  it('carries rounding upward instead of writing 4 dam', () => {
    const almost = fromCompound([dec('0'), dec('0'), dec('0'), dec('3.999')], 'hill')
    expect(toCompound(almost, 'hill').text).toBe('0-0-1-0')
    const terai = fromCompound([dec('0'), dec('19'), dec('19.999')], 'terai')
    expect(toCompound(terai, 'terai').text).toBe('1-0-0')
  })

  it('round-trips land-record notation', () => {
    for (const text of ['0-4-2-1', '2-15-3-3.5', '12-0-0-0']) {
      const parts = parseCompound(text, 'hill')!
      expect(toCompound(fromCompound(parts.map(dec), 'hill'), 'hill').text).toBe(text)
    }
    expect(toCompound(fromCompound(parseCompound('1-5-10.5', 'terai')!.map(dec), 'terai'), 'terai').text).toBe('1-5-10.5')
  })

  it('accepts over-limit parts by summing them', () => {
    expect(toCompound(fromCompound([dec('0'), dec('20'), dec('0'), dec('0')], 'hill'), 'hill').text).toBe('1-4-0-0')
  })

  it('parses separators, short forms and Devanagari digits', () => {
    expect(parseCompound('0 / 4 / 2 / 1', 'hill')).toEqual(['0', '4', '2', '1'])
    expect(parseCompound('4-2', 'hill')).toEqual(['4', '2', '0', '0'])
    expect(parseCompound('०-४-२-१', 'hill')).toEqual(['0', '4', '2', '1'])
    expect(parseCompound('1-2-3-4-5', 'hill')).toBeNull()
    expect(parseCompound('1-x', 'terai')).toBeNull()
    expect(parseCompound('12', 'hill')).toBeNull()
  })
})

describe('share fragment', () => {
  it('round-trips every mode', () => {
    const states: State[] = [
      DEFAULTS,
      { ...DEFAULTS, mode: 'terai' as const, values: ['1', '5', '10.5'] },
      { ...DEFAULTS, mode: 'unit' as const, values: ['2.5'], unit: 'ha' as const },
      { ...DEFAULTS, mode: 'plot' as const, values: [], lengthUnit: 'm' as const, plot: { ...template(4), sides: ['30', "40'6\"", '30', '40'], diagonals: [{ a: 0, b: 2, length: '50' }] } },
      { ...DEFAULTS, mode: 'plot' as const, values: [], plot: { points: [[1, 2], [30, 40]], closed: false, sides: ['12', ''], angles: ['', ''], diagonals: [] } },
    ]
    for (const state of states) expect(readFragment(writeFragment(state))).toEqual(state)
  })

  it('refuses a plot with corners off the sketch or diagonals between neighbours', () => {
    expect(readFragment('#m=plot&p=1.2_9999.4_5.5&c=1')).toEqual(DEFAULTS)
    expect(readFragment('#m=plot&p=0.0_10.0_10.10_0.10&c=1&d=0~1~5')).toEqual(DEFAULTS)
  })

  it('writes Devanagari digits as ASCII', () => {
    expect(writeFragment({ ...DEFAULTS, values: ['०', '४', '२', '१'] })).toBe('#m=hill&v=0_4_2_1')
  })

  it('falls back to defaults on anything odd', () => {
    expect(readFragment('#m=nope&v=1')).toEqual(DEFAULTS)
    expect(readFragment('#m=hill&v=<script>')).toEqual(DEFAULTS)
    expect(readFragment('')).toEqual(DEFAULTS)
  })
})

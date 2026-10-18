import { describe, expect, it } from 'vitest'
import { formatInZone, parseIsoInput, parseTimestamp, preciseIso, relativeTime, timestampField, timestampValues, zoneOptions } from './time'

describe('Unix timestamp parsing', () => {
  it('handles epoch zero and negative timestamps', () => {
    expect(parseTimestamp('0', 'auto').value?.milliseconds).toBe(0)
    expect(preciseIso(parseTimestamp('-1', 's').value!)).toBe('1969-12-31T23:59:59.000Z')
  })

  it.each([
    ['1700000000', 's', 1_700_000_000_000],
    ['1700000000000', 'ms', 1_700_000_000_000],
    ['1700000000000000', 'us', 1_700_000_000_000],
    ['1700000000000000000', 'ns', 1_700_000_000_000],
  ] as const)('auto-detects %s as %s', (raw, unit, milliseconds) => {
    const result = parseTimestamp(raw, 'auto')
    expect(result.error).toBeNull()
    expect(result.value).toMatchObject({ inferredUnit: unit, milliseconds })
  })

  it('preserves sub-millisecond nanoseconds', () => {
    const instant = parseTimestamp('1700000000123456789', 'ns').value!
    expect(preciseIso(instant)).toBe('2023-11-14T22:13:20.123456789Z')
    expect(timestampValues(instant.nanoseconds).microseconds).toBe('1700000000123456.789')
  })

  it('accepts fractional seconds and rejects malformed ranges', () => {
    expect(preciseIso(parseTimestamp('0.123456789', 's').value!)).toBe('1970-01-01T00:00:00.123456789Z')
    expect(parseTimestamp('abc', 'auto').error).toMatch(/signed number/)
    expect(parseTimestamp('999999999999999999999999999', 'ns').error).toMatch(/Date range/)
  })
})

describe('date inputs and relative output', () => {
  it('parses explicit ISO offsets as absolute instants', () => {
    const parsed = parseIsoInput('2024-03-10T01:30:00-05:00')
    expect(parsed.value?.milliseconds).toBe(Date.parse('2024-03-10T06:30:00Z'))
    expect(parsed.value?.localAssumed).toBe(false)
  })

  it('marks zone-less input as browser local', () => {
    expect(parseIsoInput('2024-11-03T01:30:00').value?.localAssumed).toBe(true)
  })

  it('formats stable relative values with a fixed clock', () => {
    expect(relativeTime(1_700_000_060_000, 1_700_000_000_000)).toMatch(/minute/)
    expect(relativeTime(1_699_913_600_000, 1_700_000_000_000)).toMatch(/yesterday|day ago/)
  })
})

describe('timestamp field written back from a date (TIME-1)', () => {
  it.each(['auto', 's', 'ms', 'us', 'ns'] as const)('round-trips through the unit it writes (%s)', (unit) => {
    for (const iso of ['2024-06-01T12:00:00Z', '2300-01-01T00:00:00Z', '1969-07-20T20:17:40.5Z', '2024-06-01T12:00:00.123456789Z', '1950-01-01T00:00:00.000000001Z']) {
      const parsed = parseIsoInput(iso).value!
      const field = timestampField(parsed.nanoseconds, unit)
      const back = parseTimestamp(field.text, field.unit)
      expect(back.error, `${iso} as ${field.text} ${field.unit}`).toBeNull()
      expect(back.value!.nanoseconds).toBe(parsed.nanoseconds)
    }
  })

  it('keeps an explicit unit and writes the value in it', () => {
    const ns = parseIsoInput('2024-06-01T12:00:00Z').value!.nanoseconds
    expect(timestampField(ns, 'ms')).toEqual({ text: '1717243200000', unit: 'ms' })
    expect(timestampField(ns, 's')).toEqual({ text: '1717243200', unit: 's' })
    expect(timestampField(ns, 'auto')).toEqual({ text: '1717243200', unit: 'auto' })
  })

  it('falls back to a unit that can hold the precision', () => {
    const ns = parseIsoInput('2024-06-01T12:00:00.123456789Z').value!.nanoseconds
    expect(timestampField(ns, 'us')).toEqual({ text: '1717243200123456789', unit: 'ns' })
    // 11-digit seconds would be auto-detected as milliseconds, so auto turns into seconds.
    expect(timestampField(parseIsoInput('2300-01-01T00:00:00Z').value!.nanoseconds, 'auto').unit).toBe('s')
  })
})

describe('strict ISO 8601 input (TIME-2/3/4)', () => {
  it.each(['1', 'March 7 2024', '2024/06/01', 'Sat, 01 Jun 2024 12:00:00 GMT', '2024-02-30', '2024-13-01', '2024-06-01T25:00', '2024-06-01T12:00:00+24:00', '2024-06-01T12', '2024-06-01T12:00:00.'])('rejects %s', (raw) => {
    expect(parseIsoInput(raw).error).toMatch(/ISO 8601/)
  })

  it.each([
    ['2024-06-01T12:00:00+05', '2024-06-01T07:00:00.000Z'],
    ['2024-06-01T12:00:00+0530', '2024-06-01T06:30:00.000Z'],
    ['2024-06-01T12:00:00-05:30', '2024-06-01T17:30:00.000Z'],
    ['2024-06-01T12:00Z', '2024-06-01T12:00:00.000Z'],
    ['2024-06-01t12:00:00z', '2024-06-01T12:00:00.000Z'],
    ['2024-06-01 12:00:00Z', '2024-06-01T12:00:00.000Z'],
    ['2024-06-01T12:00:00,5Z', '2024-06-01T12:00:00.500Z'],
    ['0099-01-01T00:00:00Z', '0099-01-01T00:00:00.000Z'],
    ['+010000-01-01T00:00:00Z', '+010000-01-01T00:00:00.000Z'],
  ])('accepts %s', (raw, expected) => {
    const parsed = parseIsoInput(raw)
    expect(parsed.error).toBeNull()
    expect(preciseIso(parsed.value!)).toBe(expected)
    expect(parsed.value!.localAssumed).toBe(false)
  })

  it('keeps nanoseconds from the fraction', () => {
    const parsed = parseIsoInput('2024-06-01T12:00:00.123456789Z').value!
    expect(parsed.nanoseconds).toBe(1_717_243_200_123_456_789n)
    expect(parsed.milliseconds).toBe(1_717_243_200_123)
    expect(preciseIso(parsed)).toBe('2024-06-01T12:00:00.123456789Z')
    const before = parseIsoInput('1969-12-31T23:59:59.999999999Z').value!
    expect(before.nanoseconds).toBe(-1n)
    expect(preciseIso(before)).toBe('1969-12-31T23:59:59.999999999Z')
    expect(parseIsoInput('2024-06-01T12:00:00.1234567891Z').error).toMatch(/9 fractional digits/)
  })

  it('reads every date-only form as local midnight, like date-times without an offset', () => {
    for (const [raw, y, m, d] of [['2024', 2024, 0, 1], ['2024-06', 2024, 5, 1], ['2024-06-15', 2024, 5, 15]] as const) {
      const parsed = parseIsoInput(raw).value!
      expect(parsed.localAssumed, raw).toBe(true)
      expect(parsed.milliseconds, raw).toBe(new Date(y, m, d).getTime())
    }
    expect(parseIsoInput('2024-06-15T08:30').value!.milliseconds).toBe(new Date(2024, 5, 15, 8, 30).getTime())
  })
})

describe('time zone choices (TIME-5)', () => {
  it('offers UTC even when Intl.supportedValuesOf leaves it out', () => {
    const list = zoneOptions(['Africa/Abidjan', 'Europe/Paris'], 'Europe/Paris')
    expect(list[0]).toBe('UTC')
    expect(list).toEqual(['UTC', 'Africa/Abidjan', 'Europe/Paris'])
    expect(zoneOptions(['Europe/Paris'], 'Asia/Unknown_Local')).toEqual(['UTC', 'Asia/Unknown_Local', 'Europe/Paris'])
    expect(zoneOptions(undefined, 'UTC')).toEqual(['UTC'])
    expect(formatInZone(0, 'UTC')).toMatch(/1970/)
  })
})

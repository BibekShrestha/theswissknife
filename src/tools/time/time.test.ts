import { describe, expect, it } from 'vitest'
import { parseIsoInput, parseTimestamp, preciseIso, relativeTime, timestampValues } from './time'

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

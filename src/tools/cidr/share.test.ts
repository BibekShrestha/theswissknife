import { describe, expect, it } from 'vitest'
import { DEFAULTS, FIELD_MAX, LIST_MAX, readFragment, writeFragment } from './share'

describe('fragment state', () => {
  it('round-trips each tab and keeps addresses readable', () => {
    const calc = writeFragment({ ...DEFAULTS, calc: '2001:db8::1/64' })
    expect(calc).toEqual({ hash: '#t=calc&q=2001:db8::1/64', omitted: false })
    expect(readFragment(calc.hash).calc).toBe('2001:db8::1/64')

    const split = writeFragment({ ...DEFAULTS, tab: 'split', splitNet: '10.0.0.0/8', splitBy: 'count', splitValue: '5' })
    expect(split.hash).toBe('#t=split&n=10.0.0.0/8&by=count&v=5')
    expect(readFragment(split.hash)).toMatchObject({ tab: 'split', splitNet: '10.0.0.0/8', splitBy: 'count', splitValue: '5' })

    const range = writeFragment({ ...DEFAULTS, tab: 'range', range: '10.0.0.1 - 10.0.0.9' })
    expect(readFragment(range.hash).range).toBe('10.0.0.1 - 10.0.0.9')

    const list = writeFragment({ ...DEFAULTS, tab: 'summarise', entries: 'a\nb&c=d+e' })
    expect(readFragment(list.hash).entries).toBe('a\nb&c=d+e')

    const zone = writeFragment({ ...DEFAULTS, calc: 'fe80::1%eth0/64' })
    expect(readFragment(zone.hash).calc).toBe('fe80::1%eth0/64')
  })

  it('writes only the open tab', () => {
    expect(writeFragment({ ...DEFAULTS, tab: 'contains' }).hash).toBe('#t=contains&a=10.1.2.3&b=10.0.0.0/8')
  })

  it('ignores unknown tabs and values, and clips what it reads', () => {
    expect(readFragment('#t=nope&q=1.2.3.4')).toEqual(DEFAULTS)
    expect(readFragment('')).toEqual(DEFAULTS)
    expect(readFragment('#t=split&by=sideways').splitBy).toBe(DEFAULTS.splitBy)
    expect(readFragment(`#t=calc&q=${'1'.repeat(5000)}`).calc).toHaveLength(FIELD_MAX)
    expect(readFragment('#t=calc&q=a%0Ab').calc).toBe('a b')
    expect(readFragment(`#t=summarise&l=${'1'.repeat(9000)}`).entries).toHaveLength(LIST_MAX)
  })

  it('leaves an over-long list out of the link and says so', () => {
    const out = writeFragment({ ...DEFAULTS, tab: 'summarise', entries: '10.0.0.0/8\n'.repeat(500) })
    expect(out).toEqual({ hash: '#t=summarise', omitted: true })
  })
})

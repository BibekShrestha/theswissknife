import { describe, expect, it } from 'vitest'
import { binaryGroups, bitLength, expandIPv6, formatIPv4, formatIPv6, parseAddress, parseIPv4, parseIPv6, reverseName, reverseZone } from './ip'

const v4 = (text: string) => {
  const r = parseIPv4(text)
  if (!r.ok) throw new Error(r.error)
  return r.value
}
const v6 = (text: string) => {
  const r = parseIPv6(text)
  if (!r.ok) throw new Error(r.error)
  return r.value.value
}
const v4Error = (text: string) => {
  const r = parseIPv4(text)
  return r.ok ? '' : r.error
}
const v6Error = (text: string) => {
  const r = parseIPv6(text)
  return r.ok ? '' : r.error
}
const canon = (text: string) => formatIPv6(v6(text))

describe('parseIPv4', () => {
  it('reads dotted quads', () => {
    expect(v4('0.0.0.0')).toBe(0n)
    expect(v4('255.255.255.255')).toBe(0xffffffffn)
    expect(v4('192.0.2.1')).toBe(0xc0000201n)
    expect(formatIPv4(0xc0000201n)).toBe('192.0.2.1')
  })

  it('rejects leading zeros and explains the octal reading', () => {
    expect(v4Error('010.0.0.1')).toMatch(/first octet “010” has a leading zero.*octal 8.*decimal 10/)
    expect(v4Error('192.168.01.1')).toMatch(/third octet/)
    expect(v4Error('1.2.3.09')).toMatch(/isn’t valid octal/)
    expect(v4Error('1.2.3.00')).toMatch(/both readings agree/)
  })

  it('rejects out-of-range, shorthand, hex and bare numbers', () => {
    expect(v4Error('256.0.0.1')).toMatch(/out of range — octets are 0–255/)
    expect(v4Error('1.2.3.99999999999')).toMatch(/out of range/)
    expect(v4Error('10.1')).toMatch(/Shorthand.*10\.0\.0\.1/)
    expect(v4Error('10.1.2')).toMatch(/3 parts/)
    expect(v4Error('1.2.3.4.5')).toMatch(/5 dotted parts/)
    expect(v4Error('0x7f.0.0.1')).toMatch(/hex/)
    expect(v4Error('0x7f000001')).toMatch(/hex number/)
    expect(v4Error('3232235777')).toMatch(/bare number/)
    expect(v4Error('1..2.3')).toMatch(/second octet is empty/)
    expect(v4Error('1.2.3.')).toMatch(/fourth octet is empty/)
    expect(v4Error('1.2.3.a')).toMatch(/not a decimal/)
    expect(v4Error('1.2.3.٣')).toMatch(/not a decimal/)
    expect(v4Error('+1.2.3.4')).toMatch(/not a decimal/)
  })
})

describe('parseIPv6', () => {
  it('reads full, compressed and mixed forms', () => {
    expect(v6('::')).toBe(0n)
    expect(v6('::1')).toBe(1n)
    expect(v6('1::')).toBe(1n << 112n)
    expect(v6('1:2:3:4:5:6:7:8')).toBe(0x00010002000300040005000600070008n)
    expect(v6('1:2:3:4:5:6:7::')).toBe(0x00010002000300040005000600070000n)
    expect(v6('::2:3:4:5:6:7:8')).toBe(0x00000002000300040005000600070008n)
    expect(v6('::ffff:192.0.2.1')).toBe(0xffffc0000201n)
    expect(v6('64:ff9b::192.0.2.33')).toBe((0x64ff9bn << 96n) | 0xc0000221n)
    expect(v6('1:2:3:4:5:6:1.2.3.4')).toBe(0x00010002000300040005000601020304n)
    expect(v6('FE80::ABCD')).toBe((0xfe80n << 112n) | 0xabcdn)
  })

  it('keeps zone ids', () => {
    const r = parseIPv6('fe80::1%eth0')
    expect(r.ok && r.value).toEqual({ value: (0xfe80n << 112n) | 1n, zone: 'eth0' })
    expect(v6Error('fe80::1%')).toMatch(/Empty zone/)
  })

  it('rejects more than one ::, and explains why', () => {
    expect(v6Error('1::2::3')).toMatch(/More than one “::”.*ambiguous/)
    expect(v6Error('::1::')).toMatch(/More than one/)
    expect(v6Error('1:::2')).toMatch(/Three colons/)
  })

  it('rejects malformed groups and counts', () => {
    expect(v6Error('12345::')).toMatch(/more than four|has 5 hex digits/)
    expect(v6Error('1:2:3:4:5:6:7')).toMatch(/Only 7 of 8/)
    expect(v6Error('1:2:3:4:5:6:7:8:9')).toMatch(/9 groups/)
    expect(v6Error('1:2:3:4:5:6:7:8::')).toMatch(/at least one zero group/)
    expect(v6Error('::1:2:3:4:5:6:7:8')).toMatch(/at least one zero group/)
    expect(v6Error(':1::')).toMatch(/starts with a single/)
    expect(v6Error('1::2:')).toMatch(/ends with a single/)
    expect(v6Error(':')).toMatch(/single/)
    expect(v6Error('g::1')).toMatch(/“g” can’t appear/)
    expect(v6Error('1:2:3:4:5:6:7:1.2.3.4')).toMatch(/9 groups/)
  })

  it('only accepts dotted IPv4 as the last 32 bits, strictly', () => {
    expect(v6Error('::1.2.3.4:1')).toMatch(/only be the last 32 bits/)
    expect(v6Error('1.2.3.4::')).toMatch(/only be the last 32 bits/)
    expect(v6Error('::ffff:01.2.3.4')).toMatch(/Embedded IPv4.*leading zero/)
    expect(v6Error('::ffff:1.2.3')).toMatch(/Embedded IPv4/)
  })
})

describe('parseAddress', () => {
  it('picks the family, strips brackets and refuses IPv4 zones', () => {
    const a = parseAddress(' [2001:db8::1] ')
    expect(a.ok && a.value.family).toBe(6)
    const b = parseAddress('192.0.2.1%eth0')
    expect(b.ok ? '' : b.error).toMatch(/only apply to IPv6/)
    const c = parseAddress('[192.0.2.1]')
    expect(c.ok ? '' : c.error).toMatch(/only for IPv6/)
    expect(parseAddress('').ok).toBe(false)
  })
})

describe('formatIPv6 (RFC 5952)', () => {
  it('§4.1 suppresses leading zeros', () => {
    expect(canon('2001:0db8::0001')).toBe('2001:db8::1')
  })

  it('§4.2.1 shortens as much as possible', () => {
    expect(canon('2001:db8:0:0:0:0:2:1')).toBe('2001:db8::2:1')
    expect(canon('2001:db8::0:1')).toBe('2001:db8::1')
  })

  it('§4.2.2 never shortens a single 16-bit zero field', () => {
    expect(canon('2001:db8:0:1:1:1:1:1')).toBe('2001:db8:0:1:1:1:1:1')
  })

  it('§4.2.3 shortens the longest run, the first one on a tie', () => {
    expect(canon('2001:0:0:1:0:0:0:1')).toBe('2001:0:0:1::1')
    expect(canon('2001:db8:0:0:1:0:0:1')).toBe('2001:db8::1:0:0:1')
  })

  it('§4.3 is lowercase', () => {
    expect(canon('2001:DB8::ABCD:EF')).toBe('2001:db8::abcd:ef')
  })

  it('§2.1: every variant of one address has one canonical form', () => {
    for (const text of [
      '2001:db8:0:0:1:0:0:1', '2001:0db8:0:0:1:0:0:1', '2001:db8::1:0:0:1', '2001:db8::0:1:0:0:1',
      '2001:0db8::1:0:0:1', '2001:db8:0:0:1::1', '2001:db8:0000:0:1::1', '2001:DB8:0:0:1::1',
    ]) expect(canon(text)).toBe('2001:db8::1:0:0:1')
  })

  it('§5 writes IPv4-mapped addresses in mixed notation', () => {
    expect(canon('0:0:0:0:0:ffff:c000:201')).toBe('::ffff:192.0.2.1')
    // The NAT64 prefix is not distinguishable from ordinary addresses by everyone; keep hex.
    expect(canon('64:ff9b::192.0.2.1')).toBe('64:ff9b::c000:201')
  })

  it('handles the ends of the space', () => {
    expect(canon('0:0:0:0:0:0:0:0')).toBe('::')
    expect(canon('0:0:0:0:0:0:0:1')).toBe('::1')
    expect(canon('1:0:0:0:0:0:0:0')).toBe('1::')
    expect(canon('1:0:0:0:0:0:0:1')).toBe('1::1')
    expect(canon('1:0:1:0:1:0:1:0')).toBe('1:0:1:0:1:0:1:0')
    expect(canon('ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')).toBe('ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')
    expect(canon('0:0:1:0:0:0:0:0')).toBe('0:0:1::')
  })

  it('round-trips random addresses with zero runs (seeded)', () => {
    let seed = 0x2545f491
    const next = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed }
    for (let n = 0; n < 2000; n++) {
      let value = 0n
      for (let g = 0; g < 8; g++) value = (value << 16n) | BigInt(next() % 3 === 0 ? 0 : next() & 0xffff)
      const text = formatIPv6(value)
      expect(v6(text)).toBe(value)
      expect(canon(text)).toBe(text)
      expect(v6(expandIPv6(value))).toBe(value)
      expect(text).not.toMatch(/(^|:)0[0-9a-f]/)
      expect(text.split('::').length).toBeLessThanOrEqual(2)
    }
  })
})

describe('reverse DNS', () => {
  it('names IPv4 and IPv6 PTRs and zones', () => {
    expect(reverseName({ family: 4, value: v4('192.0.2.1') })).toBe('1.2.0.192.in-addr.arpa')
    expect(reverseZone({ family: 4, value: v4('192.0.2.0') }, 24)).toBe('2.0.192.in-addr.arpa')
    expect(reverseZone({ family: 4, value: v4('10.0.0.0') }, 9)).toBe('10.in-addr.arpa')
    expect(reverseZone({ family: 4, value: 0n }, 0)).toBe('in-addr.arpa')
    // RFC 3596 §2.5's example.
    expect(reverseName({ family: 6, value: v6('4321:0:1:2:3:4:567:89ab') }))
      .toBe('b.a.9.8.7.6.5.0.4.0.0.0.3.0.0.0.2.0.0.0.1.0.0.0.0.0.0.0.1.2.3.4.ip6.arpa')
    expect(reverseZone({ family: 6, value: v6('2001:db8::') }, 32)).toBe('8.b.d.0.1.0.0.2.ip6.arpa')
  })
})

describe('helpers', () => {
  it('bitLength and binaryGroups', () => {
    expect(bitLength(0n)).toBe(0)
    expect(bitLength(1n)).toBe(1)
    expect(bitLength((1n << 128n) - 1n)).toBe(128)
    expect(binaryGroups({ family: 4, value: v4('192.0.2.1') })).toEqual(['11000000', '00000000', '00000010', '00000001'])
    expect(binaryGroups({ family: 6, value: 1n })).toHaveLength(8)
  })
})

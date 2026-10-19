import { describe, expect, it } from 'vitest'
import {
  type Net, type Range, compareRanges, formatCount, formatNet, hostsOf, mergeRanges, parseAny, parseCidr, parseCount,
  planSplitByCount, planSplitByPrefix, rangeOfAny, rangeToCidrs, splitTokens, subnetAt, subnetPage, summarise, toNet,
} from './cidr'
import { formatAddr, parseAddress } from './ip'

const cidr = (text: string) => {
  const r = parseCidr(text)
  if (!r.ok) throw new Error(r.error)
  return r.value
}
const net = (text: string): Net => toNet(cidr(text)).net
const err = (text: string) => {
  const r = parseCidr(text)
  return r.ok ? '' : r.error
}
const addr = (text: string) => {
  const r = parseAddress(text)
  if (!r.ok) throw new Error(r.error)
  return r.value
}
const range = (a: string, b: string): Range => ({ family: addr(a).family, start: addr(a).value, end: addr(b).value })
const fmt = (value: bigint, family: 4 | 6 = 4) => formatAddr({ family, value })
const list = (nets: Net[]) => nets.map(formatNet)

describe('parseCidr', () => {
  it('reads prefixes, netmasks and wildcard masks', () => {
    expect(cidr('192.0.2.0/24')).toMatchObject({ prefix: 24, form: 'prefix' })
    expect(cidr('192.0.2.0/255.255.255.0')).toMatchObject({ prefix: 24, form: 'netmask' })
    expect(cidr('192.0.2.0 255.255.255.0')).toMatchObject({ prefix: 24, form: 'netmask' })
    expect(cidr('192.0.2.0 0.0.0.255')).toMatchObject({ prefix: 24, form: 'wildcard' })
    expect(cidr('10.0.0.0 0.255.255.255')).toMatchObject({ prefix: 8, form: 'wildcard' })
    expect(cidr('192.0.2.7')).toMatchObject({ prefix: 32, form: 'address' })
    expect(cidr('2001:db8::/32')).toMatchObject({ family: 6, prefix: 32 })
    expect(cidr('2001:db8::1')).toMatchObject({ family: 6, prefix: 128 })
    expect(cidr('fe80::1%eth0/64')).toMatchObject({ family: 6, prefix: 64, zone: 'eth0' })
    expect(cidr(' 10.0.0.0 / 8 ')).toMatchObject({ prefix: 8 })
  })

  it('notes masks that read both ways', () => {
    expect(cidr('0.0.0.0 0.0.0.0')).toMatchObject({ prefix: 0, form: 'netmask' })
    expect(cidr('0.0.0.0 0.0.0.0').notes[0]).toMatch(/as a wildcard mask it would mean \/32/)
    expect(cidr('192.0.2.1 255.255.255.255')).toMatchObject({ prefix: 32, form: 'netmask' })
  })

  it('rejects bad prefixes and masks with reasons', () => {
    expect(err('10.0.0.0/33')).toMatch(/out of range.*0–32/)
    expect(err('2001:db8::/129')).toMatch(/0–128/)
    expect(err('10.0.0.0/08')).toMatch(/leading zero/)
    expect(err('10.0.0.0/')).toMatch(/Missing prefix/)
    expect(err('10.0.0.0/x')).toMatch(/not a number/)
    expect(err('10.0.0.0/8/9')).toMatch(/More than one “\/”/)
    expect(err('10.0.0.0 255.0.255.0')).toMatch(/not a contiguous mask/)
    expect(err('10.0.0.0/255.255.255.01')).toMatch(/leading zero/)
    expect(err('10.0.0.0 ffff::')).toMatch(/mask is IPv6/)
    expect(err('010.0.0.0/8')).toMatch(/octal/)
    expect(err('1 2 3')).toMatch(/at most one mask/)
  })

  it('finds the network of an address with host bits set', () => {
    const r = toNet(cidr('192.168.1.10/24'))
    expect(r.hostBits).toBe(true)
    expect(formatNet(r.net)).toBe('192.168.1.0/24')
    expect(toNet(cidr('192.168.1.0/24')).hostBits).toBe(false)
  })
})

describe('hostsOf', () => {
  it('IPv4 ordinary subnets lose network and broadcast', () => {
    const h = hostsOf(net('192.0.2.0/24'))
    expect([fmt(h.first), fmt(h.last), fmt(h.broadcast!), h.usable]).toEqual(['192.0.2.1', '192.0.2.254', '192.0.2.255', 254n])
    expect(hostsOf(net('10.0.0.0/30')).usable).toBe(2n)
    expect(hostsOf(net('0.0.0.0/0')).usable).toBe(4294967294n)
  })

  it('IPv4 /31 (RFC 3021) and /32', () => {
    const p2p = hostsOf(net('203.0.113.6/31'))
    expect([fmt(p2p.first), fmt(p2p.last), p2p.usable, p2p.broadcast]).toEqual(['203.0.113.6', '203.0.113.7', 2n, undefined])
    expect(p2p.rule).toMatch(/RFC 3021/)
    const one = hostsOf(net('203.0.113.9/32'))
    expect([fmt(one.first), fmt(one.last), one.usable]).toEqual(['203.0.113.9', '203.0.113.9', 1n])
  })

  it('IPv6 skips the Subnet-Router anycast address except /127 and /128', () => {
    const h = hostsOf(net('2001:db8::/64'))
    expect([fmt(h.first, 6), fmt(h.last, 6), h.usable, h.broadcast]).toEqual(['2001:db8::1', '2001:db8::ffff:ffff:ffff:ffff', (1n << 64n) - 1n, undefined])
    const p2p = hostsOf(net('2001:db8::/127'))
    expect([fmt(p2p.first, 6), fmt(p2p.last, 6), p2p.usable]).toEqual(['2001:db8::', '2001:db8::1', 2n])
    expect(p2p.rule).toMatch(/RFC 6164/)
    expect(hostsOf(net('2001:db8::5/128')).usable).toBe(1n)
    expect(hostsOf(net('::/0')).usable).toBe((1n << 128n) - 1n)
  })
})

describe('rangeToCidrs', () => {
  it('finds the minimal list', () => {
    expect(list(rangeToCidrs(range('192.0.2.0', '192.0.2.255')))).toEqual(['192.0.2.0/24'])
    expect(list(rangeToCidrs(range('10.0.0.1', '10.0.0.6')))).toEqual(['10.0.0.1/32', '10.0.0.2/31', '10.0.0.4/31', '10.0.0.6/32'])
    expect(list(rangeToCidrs(range('0.0.0.0', '255.255.255.255')))).toEqual(['0.0.0.0/0'])
    expect(list(rangeToCidrs(range('255.255.255.255', '255.255.255.255')))).toEqual(['255.255.255.255/32'])
    expect(list(rangeToCidrs(range('::', 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')))).toEqual(['::/0'])
    expect(list(rangeToCidrs(range('2001:db8::', '2001:db8::2')))).toEqual(['2001:db8::/127', '2001:db8::2/128'])
  })

  it('hits the 2 × bits − 2 worst case', () => {
    expect(rangeToCidrs(range('0.0.0.1', '255.255.255.254'))).toHaveLength(62)
    expect(rangeToCidrs(range('::1', 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:fffe'))).toHaveLength(254)
  })

  it('covers exactly the range, with aligned blocks (seeded)', () => {
    let seed = 7
    const next = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed }
    for (let n = 0; n < 300; n++) {
      const a = BigInt(next()), b = BigInt(next())
      const r: Range = { family: 4, start: a < b ? a : b, end: a < b ? b : a }
      const out = rangeToCidrs(r)
      let at = r.start
      for (const block of out) {
        expect(block.base).toBe(at)
        const size = 1n << BigInt(32 - block.prefix)
        expect(block.base % size).toBe(0n)
        at += size
      }
      expect(at - 1n).toBe(r.end)
      // Minimal: no two neighbours could merge into one aligned block.
      for (let i = 1; i < out.length; i++) {
        const [x, y] = [out[i - 1], out[i]]
        const mergeable = x.prefix === y.prefix && x.prefix > 0 && x.base % (1n << BigInt(33 - x.prefix)) === 0n
        expect(mergeable).toBe(false)
      }
    }
  })
})

describe('summarise', () => {
  it('merges adjacent and nested blocks', () => {
    const r = summarise('10.0.0.0/25\n10.0.0.128/25\n10.0.1.0/24\n10.0.0.64/26\n192.168.0.0/16')
    expect(list(r.output)).toEqual(['10.0.0.0/23', '192.168.0.0/16'])
    expect(r.redundant.map((item) => [item.text, formatNet(item.within)])).toEqual([['10.0.0.64/26', '10.0.0.0/25']])
    expect(r.inputs).toBe(5)
    expect(r.addresses[4]).toBe(512n + 65536n)
  })

  it('keeps families apart, lists errors and host-bit inputs', () => {
    const r = summarise('2001:db8::/33, 2001:db8:8000::/33\n10.0.0.5/8 # comment\nnope\n10.0.0.0/8\n010.1.1.1')
    expect(list(r.output)).toEqual(['10.0.0.0/8', '2001:db8::/32'])
    expect(r.errors.map((e) => e.line)).toEqual([3, 5])
    expect(r.normalised.map((n) => formatNet(n.net))).toEqual(['10.0.0.0/8'])
    expect(r.redundant).toHaveLength(1)
  })

  it('accepts ranges, bare addresses and address-mask pairs', () => {
    const r = summarise('192.0.2.0 - 192.0.2.127\n192.0.2.128 255.255.255.128\n10.0.0.1 10.0.0.2\n10.0.0.3')
    expect(list(r.output)).toEqual(['10.0.0.1/32', '10.0.0.2/31', '192.0.2.0/24'])
  })

  it('is exact: the output covers the same addresses as the input (seeded)', () => {
    let seed = 99
    const next = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed }
    for (let n = 0; n < 50; n++) {
      const blocks: Net[] = Array.from({ length: 30 }, () => {
        const prefix = 20 + (next() % 13)
        const base = BigInt(0x0a000000 + (next() & 0xfffff)) & ~((1n << BigInt(32 - prefix)) - 1n)
        return { family: 4, base, prefix }
      })
      const r = summarise(blocks.map(formatNet).join('\n'))
      const covered = (nets: Net[], ip: bigint) => nets.some((b) => ip >= b.base && ip < b.base + (1n << BigInt(32 - b.prefix)))
      for (let k = 0; k < 200; k++) {
        const ip = BigInt(0x0a000000 + (next() & 0xfffff))
        expect(covered(r.output, ip)).toBe(covered(blocks, ip))
      }
      // Minimal: the output is what range → CIDR gives for the merged union.
      const merged = mergeRanges(blocks.map((b) => ({ family: 4, start: b.base, end: b.base + (1n << BigInt(32 - b.prefix)) - 1n })))
      expect(r.output.length).toBe(merged.flatMap(rangeToCidrs).length)
    }
  })

  it('splits tokens without breaking ranges or mask pairs', () => {
    expect(splitTokens('10.0.0.0/8 192.168.0.0/16')).toEqual(['10.0.0.0/8', '192.168.0.0/16'])
    expect(splitTokens('10.0.0.1 - 10.0.0.9')).toEqual(['10.0.0.1 - 10.0.0.9'])
    expect(splitTokens('10.0.0.0 255.0.0.0, 2001:db8::/32')).toEqual(['10.0.0.0 255.0.0.0', '2001:db8::/32'])
    expect(splitTokens('10.0.0.1 10.0.0.2')).toEqual(['10.0.0.1', '10.0.0.2'])
  })
})

describe('parseAny and compareRanges', () => {
  const any = (text: string) => {
    const r = parseAny(text)
    if (!r.ok) throw new Error(r.error)
    return rangeOfAny(r.value)
  }
  const anyErr = (text: string) => {
    const r = parseAny(text)
    return r.ok ? '' : r.error
  }

  it('reads ranges with hyphens, dashes and "to"', () => {
    expect(any('10.0.0.1-10.0.0.9')).toEqual(range('10.0.0.1', '10.0.0.9'))
    expect(any('10.0.0.1 – 10.0.0.9')).toEqual(range('10.0.0.1', '10.0.0.9'))
    expect(any('2001:db8::1 to 2001:db8::ff')).toEqual(range('2001:db8::1', '2001:db8::ff'))
    expect(any('10.0.0.0/8')).toEqual(range('10.0.0.0', '10.255.255.255'))
    expect(anyErr('10.0.0.9 - 10.0.0.1')).toMatch(/after the end/)
    expect(anyErr('10.0.0.1 - ::1')).toMatch(/IPv4 and the end IPv6/)
    expect(anyErr('10.0.0.1 - ')).toMatch(/both a start and an end/)
    expect(anyErr('10.0.0.0/8 - 11.0.0.0/8')).toMatch(/without a prefix/)
    expect(anyErr('1.1.1.1-2.2.2.2-3.3.3.3')).toMatch(/one start and one end/)
  })

  it('classifies relations', () => {
    expect(compareRanges(any('10.1.2.3'), any('10.0.0.0/8')).relation).toBe('a-in-b')
    expect(compareRanges(any('10.0.0.0/8'), any('10.1.0.0/16')).relation).toBe('b-in-a')
    expect(compareRanges(any('10.0.0.0/8'), any('10.0.0.0 255.0.0.0')).relation).toBe('equal')
    expect(compareRanges(any('10.0.0.0/8'), any('11.0.0.0/8'))).toEqual({ relation: 'disjoint', overlapCount: 0n })
    expect(compareRanges(any('10.0.0.0/8'), any('::/0')).relation).toBe('family')
    const partial = compareRanges(any('10.0.0.0 - 10.0.0.200'), any('10.0.0.128/25'))
    expect(partial.relation).toBe('overlap')
    expect(partial.overlapCount).toBe(73n)
    expect(list(rangeToCidrs(partial.overlap!))).toEqual(['10.0.0.128/26', '10.0.0.192/29', '10.0.0.200/32'])
  })
})

describe('split', () => {
  it('by prefix, indexed without building the list', () => {
    const plan = planSplitByPrefix(net('10.0.0.0/8'), 32)
    expect(plan.ok && plan.value.count).toBe(16777216n)
    if (!plan.ok) return
    expect(formatNet(subnetAt(plan.value, 16777215n))).toBe('10.255.255.255/32')
    expect(list(subnetPage(plan.value, 0n, 3))).toEqual(['10.0.0.0/32', '10.0.0.1/32', '10.0.0.2/32'])
    expect(subnetPage(plan.value, 16777214n, 256)).toHaveLength(2)
    expect(subnetPage(plan.value, 99999999n, 256)).toHaveLength(0)
  })

  it('by prefix in IPv6, where counts pass 2^53', () => {
    const plan = planSplitByPrefix(net('2001:db8::/32'), 128)
    expect(plan.ok && plan.value.count).toBe(1n << 96n)
    if (!plan.ok) return
    expect(formatNet(subnetAt(plan.value, (1n << 96n) - 1n))).toBe('2001:db8:ffff:ffff:ffff:ffff:ffff:ffff/128')
  })

  it('rejects a shorter prefix', () => {
    const plan = planSplitByPrefix(net('10.0.0.0/16'), 8)
    expect(plan.ok ? '' : plan.error).toMatch(/larger than the \/16/)
  })

  it('by count rounds up to a power of two', () => {
    const three = planSplitByCount(net('192.0.2.0/24'), 3n)
    expect(three.ok && [three.value.prefix, three.value.count, three.value.requested]).toEqual([26, 4n, 3n])
    const four = planSplitByCount(net('192.0.2.0/24'), 4n)
    expect(four.ok && four.value.requested).toBeUndefined()
    const one = planSplitByCount(net('192.0.2.0/24'), 1n)
    expect(one.ok && one.value.prefix).toBe(24)
    const tooMany = planSplitByCount(net('192.0.2.0/24'), 257n)
    expect(tooMany.ok ? '' : tooMany.error).toMatch(/can’t be split into 257/)
    expect(planSplitByCount(net('192.0.2.0/24'), 0n).ok).toBe(false)
  })

  it('parses counts as bigint', () => {
    expect(parseCount('1,000')).toEqual({ ok: true, value: 1000n })
    expect(parseCount('18446744073709551616')).toEqual({ ok: true, value: 1n << 64n })
    expect(parseCount('-1').ok).toBe(false)
    expect(parseCount('1e3').ok).toBe(false)
  })
})

describe('formatCount', () => {
  it('shows exact digits and the power of two', () => {
    expect(formatCount(254n)).toBe('254')
    expect(formatCount(65536n)).toBe('65,536')
    expect(formatCount(1n << 64n)).toBe('18,446,744,073,709,551,616 (2^64)')
  })
})

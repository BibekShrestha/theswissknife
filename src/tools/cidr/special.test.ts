import { describe, expect, it } from 'vitest'
import { formatNet } from './cidr'
import { parseAddress } from './ip'
import { BLOCKS, blocksWithin, classify, embedded, summaryTag } from './special'

const addr = (text: string) => {
  const r = parseAddress(text)
  if (!r.ok) throw new Error(r.error)
  return r.value
}
const top = (text: string) => summaryTag(addr(text), classify(addr(text)))
const names = (text: string) => classify(addr(text)).map((block) => block.cidr)

describe('special-purpose registry', () => {
  it('has well-formed, unique blocks', () => {
    for (const family of [4, 6] as const) {
      const cidrs = BLOCKS[family].map((block) => block.cidr)
      expect(new Set(cidrs).size).toBe(cidrs.length)
      // Each entry is written canonically, so the table reads like the registry
      // (which spells the mapped block in hex; RFC 5952 §5 prints it dotted).
      for (const block of BLOCKS[family]) expect(formatNet(block.net)).toBe(block.cidr === '::ffff:0:0/96' ? '::ffff:0.0.0.0/96' : block.cidr)
    }
  })

  it('classifies common IPv4 blocks', () => {
    expect(top('10.1.2.3').tag).toBe('private')
    expect(top('172.31.255.255').tag).toBe('private')
    expect(top('172.32.0.0').tag).toBe('public')
    expect(top('192.168.0.1').tag).toBe('private')
    expect(top('100.64.0.1').tag).toBe('shared')
    expect(top('100.127.255.255').tag).toBe('shared')
    expect(top('100.128.0.0').tag).toBe('public')
    expect(top('127.0.0.1').tag).toBe('loopback')
    expect(top('169.254.1.1').tag).toBe('link-local')
    expect(top('192.0.2.1').tag).toBe('documentation')
    expect(top('198.51.100.1').tag).toBe('documentation')
    expect(top('203.0.113.1').tag).toBe('documentation')
    expect(top('198.19.0.1').tag).toBe('benchmarking')
    expect(top('224.0.0.251').tag).toBe('multicast')
    expect(top('239.1.1.1').text).toMatch(/Administratively/)
    expect(top('255.255.255.255').tag).toBe('broadcast')
    expect(top('250.0.0.1').tag).toBe('reserved')
    expect(top('0.0.0.0').tag).toBe('unspecified')
    expect(top('8.8.8.8')).toEqual({ tag: 'public', text: expect.stringMatching(/not in any special-purpose/) })
    expect(names('192.0.0.9')).toEqual(['192.0.0.9/32', '192.0.0.0/24'])
  })

  it('classifies common IPv6 blocks', () => {
    expect(top('::1').tag).toBe('loopback')
    expect(top('::').tag).toBe('unspecified')
    expect(top('::ffff:192.0.2.1').tag).toBe('translation')
    expect(top('fd12:3456::1').tag).toBe('unique-local')
    expect(top('fe80::1').tag).toBe('link-local')
    expect(top('2001:db8::1').tag).toBe('documentation')
    expect(top('3fff::1').tag).toBe('documentation')
    expect(top('2002:c000:201::1').tag).toBe('tunnel')
    expect(top('2001:0:4136:e378:8000:63bf:3fff:fdd2').text).toBe('TEREDO')
    expect(top('ff02::1').text).toMatch(/All Nodes/)
    expect(top('2606:4700::1')).toEqual({ tag: 'global', text: expect.stringMatching(/Global unicast/) })
    expect(top('4000::1').tag).toBe('reserved')
    expect(names('2001:1::1')).toEqual(['2001:1::1/128', '2001::/23', '2000::/3'])
  })

  it('decodes embedded IPv4 and multicast fields', () => {
    const fields = (text: string) => Object.fromEntries(embedded(addr(text)).map((e) => [e.label, e.value]))
    expect(fields('::ffff:192.0.2.1')).toEqual({ 'IPv4 (mapped)': '192.0.2.1' })
    expect(fields('64:ff9b::c000:221')).toEqual({ 'IPv4 (NAT64)': '192.0.2.33' })
    expect(fields('2002:c000:201::1')).toEqual({ 'IPv4 (6to4)': '192.0.2.1' })
    // RFC 4380 §4's example: server 65.54.227.120, client 192.0.2.45, port 40000.
    expect(fields('2001:0:4136:e378:8000:63bf:3fff:fdd2')).toEqual({
      'Teredo server': '65.54.227.120', 'Teredo client': '192.0.2.45', 'Teredo port': '40000', 'Teredo flags': '0x8000',
    })
    expect(fields('ff02::1')['Multicast scope']).toBe('2 · link-local')
    expect(fields('ff15::1')['Multicast scope']).toBe('5 · site-local')
    expect(fields('ff15::1')['Multicast flags']).toMatch(/transient/)
    expect(embedded(addr('192.0.2.1'))).toEqual([])
  })

  it('lists blocks inside a wide network', () => {
    const r = parseAddress('192.0.0.0')
    if (!r.ok) throw new Error(r.error)
    const within = blocksWithin({ family: 4, base: r.value.value, prefix: 8 }).map((b) => b.cidr)
    expect(within).toContain('192.168.0.0/16')
    expect(within).toContain('192.0.2.0/24')
    expect(within).not.toContain('10.0.0.0/8')
  })
})

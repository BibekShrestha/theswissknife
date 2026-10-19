/**
 * Special-purpose address blocks.
 *
 * Sources (IANA, transcribed by hand; check them when updating):
 * - IANA IPv4 Special-Purpose Address Registry
 *   https://www.iana.org/assignments/iana-ipv4-special-registry/
 * - IANA IPv6 Special-Purpose Address Registry
 *   https://www.iana.org/assignments/iana-ipv6-special-registry/
 * - IANA IPv4 Multicast Address Space Registry (224.0.0.0/4 and the blocks
 *   below) https://www.iana.org/assignments/multicast-addresses/
 * - IANA IPv6 Address Space (2000::/3, fc00::/7, fe80::/10, fec0::/10,
 *   ff00::/8) https://www.iana.org/assignments/ipv6-address-space/
 * - IANA IPv6 Multicast Address Space Registry (ff02::1, ff02::2,
 *   ff02::1:ff00:0/104) https://www.iana.org/assignments/ipv6-multicast-addresses/
 * - RFC 7346 for the IPv6 multicast scope values.
 *
 * Only blocks that are exact CIDRs are listed; the multicast registry's
 * AD-HOC and GLOP ranges are not.
 */
import { type Addr, type Family, formatIPv4 } from './ip'
import { type Net, lastOf, parseCidr, toNet } from './cidr'

export type Tag =
  | 'private' | 'loopback' | 'link-local' | 'shared' | 'documentation' | 'multicast'
  | 'reserved' | 'unspecified' | 'broadcast' | 'benchmarking' | 'translation'
  | 'tunnel' | 'anycast' | 'unique-local' | 'global' | 'deprecated' | 'protocol' | 'discard'

export interface Block {
  net: Net
  cidr: string
  name: string
  rfc: string
  tag: Tag
}

const V4: [string, string, string, Tag][] = [
  ['0.0.0.0/8', '“This network”', 'RFC 791 §3.2', 'reserved'],
  ['0.0.0.0/32', '“This host on this network”', 'RFC 1122 §3.2.1.3', 'unspecified'],
  ['10.0.0.0/8', 'Private-Use', 'RFC 1918', 'private'],
  ['100.64.0.0/10', 'Shared Address Space (carrier-grade NAT)', 'RFC 6598', 'shared'],
  ['127.0.0.0/8', 'Loopback', 'RFC 1122 §3.2.1.3', 'loopback'],
  ['169.254.0.0/16', 'Link Local', 'RFC 3927', 'link-local'],
  ['172.16.0.0/12', 'Private-Use', 'RFC 1918', 'private'],
  ['192.0.0.0/24', 'IETF Protocol Assignments', 'RFC 6890', 'protocol'],
  ['192.0.0.0/29', 'IPv4 Service Continuity Prefix (DS-Lite)', 'RFC 7335', 'protocol'],
  ['192.0.0.8/32', 'IPv4 dummy address', 'RFC 7600', 'protocol'],
  ['192.0.0.9/32', 'Port Control Protocol Anycast', 'RFC 7723', 'anycast'],
  ['192.0.0.10/32', 'Traversal Using Relays around NAT Anycast', 'RFC 8155', 'anycast'],
  ['192.0.0.170/32', 'NAT64/DNS64 Discovery', 'RFC 8880, RFC 7050 §2.2', 'protocol'],
  ['192.0.0.171/32', 'NAT64/DNS64 Discovery', 'RFC 8880, RFC 7050 §2.2', 'protocol'],
  ['192.0.2.0/24', 'Documentation (TEST-NET-1)', 'RFC 5737', 'documentation'],
  ['192.31.196.0/24', 'AS112-v4', 'RFC 7535', 'anycast'],
  ['192.52.193.0/24', 'AMT', 'RFC 7450', 'protocol'],
  ['192.88.99.0/24', 'Deprecated (6to4 Relay Anycast)', 'RFC 7526', 'deprecated'],
  ['192.88.99.2/32', '6a44-relay anycast address', 'RFC 6751', 'anycast'],
  ['192.168.0.0/16', 'Private-Use', 'RFC 1918', 'private'],
  ['192.175.48.0/24', 'Direct Delegation AS112 Service', 'RFC 7534', 'anycast'],
  ['198.18.0.0/15', 'Benchmarking', 'RFC 2544', 'benchmarking'],
  ['198.51.100.0/24', 'Documentation (TEST-NET-2)', 'RFC 5737', 'documentation'],
  ['203.0.113.0/24', 'Documentation (TEST-NET-3)', 'RFC 5737', 'documentation'],
  ['240.0.0.0/4', 'Reserved (former Class E)', 'RFC 1112 §4', 'reserved'],
  ['255.255.255.255/32', 'Limited Broadcast', 'RFC 8190, RFC 919 §7', 'broadcast'],
  // IPv4 Multicast Address Space Registry
  ['224.0.0.0/4', 'Multicast', 'RFC 5771', 'multicast'],
  ['224.0.0.0/24', 'Local Network Control Block (link-local multicast)', 'RFC 5771', 'multicast'],
  ['224.0.1.0/24', 'Internetwork Control Block', 'RFC 5771', 'multicast'],
  ['232.0.0.0/8', 'Source-Specific Multicast', 'RFC 4607', 'multicast'],
  ['233.252.0.0/24', 'Documentation (MCAST-TEST-NET)', 'RFC 6676', 'documentation'],
  ['239.0.0.0/8', 'Administratively Scoped', 'RFC 2365', 'multicast'],
]

const V6: [string, string, string, Tag][] = [
  ['::/128', 'Unspecified Address', 'RFC 4291 §2.5.2', 'unspecified'],
  ['::1/128', 'Loopback Address', 'RFC 4291 §2.5.3', 'loopback'],
  ['::/96', 'Deprecated (IPv4-Compatible IPv6)', 'RFC 4291 §2.5.5.1', 'deprecated'],
  ['::ffff:0:0/96', 'IPv4-mapped Address', 'RFC 4291 §2.5.5.2', 'translation'],
  ['64:ff9b::/96', 'IPv4-IPv6 Translation (NAT64 well-known prefix)', 'RFC 6052', 'translation'],
  ['64:ff9b:1::/48', 'IPv4-IPv6 Translation (local use)', 'RFC 8215', 'translation'],
  ['100::/64', 'Discard-Only Address Block', 'RFC 6666', 'discard'],
  ['2000::/3', 'Global Unicast', 'RFC 4291 §2.4', 'global'],
  ['2001::/23', 'IETF Protocol Assignments', 'RFC 2928', 'protocol'],
  ['2001::/32', 'TEREDO', 'RFC 4380, RFC 8190', 'tunnel'],
  ['2001:1::1/128', 'Port Control Protocol Anycast', 'RFC 7723', 'anycast'],
  ['2001:1::2/128', 'Traversal Using Relays around NAT Anycast', 'RFC 8155', 'anycast'],
  ['2001:1::3/128', 'DNS-SD Service Registration Protocol Anycast', 'RFC 9665', 'anycast'],
  ['2001:2::/48', 'Benchmarking', 'RFC 5180', 'benchmarking'],
  ['2001:3::/32', 'AMT', 'RFC 7450', 'protocol'],
  ['2001:4:112::/48', 'AS112-v6', 'RFC 7535', 'anycast'],
  ['2001:10::/28', 'Deprecated (previously ORCHID)', 'RFC 4843', 'deprecated'],
  ['2001:20::/28', 'ORCHIDv2', 'RFC 7343', 'protocol'],
  ['2001:30::/28', 'Drone Remote ID Protocol Entity Tags (DETs)', 'RFC 9374', 'protocol'],
  ['2001:db8::/32', 'Documentation', 'RFC 3849', 'documentation'],
  ['2002::/16', '6to4', 'RFC 3056', 'tunnel'],
  ['2620:4f:8000::/48', 'Direct Delegation AS112 Service', 'RFC 7534', 'anycast'],
  ['3fff::/20', 'Documentation', 'RFC 9637', 'documentation'],
  ['5f00::/16', 'Segment Routing (SRv6) SIDs', 'RFC 9602', 'protocol'],
  ['fc00::/7', 'Unique-Local', 'RFC 4193, RFC 8190', 'unique-local'],
  ['fe80::/10', 'Link-Local Unicast', 'RFC 4291 §2.5.6', 'link-local'],
  ['fec0::/10', 'Deprecated (site-local)', 'RFC 3879', 'deprecated'],
  ['ff00::/8', 'Multicast', 'RFC 4291 §2.7', 'multicast'],
  ['ff02::1/128', 'All Nodes (link-local multicast)', 'RFC 4291 §2.7.1', 'multicast'],
  ['ff02::2/128', 'All Routers (link-local multicast)', 'RFC 4291 §2.7.1', 'multicast'],
  ['ff02::1:ff00:0/104', 'Solicited-Node multicast', 'RFC 4291 §2.7.1', 'multicast'],
]

function build(rows: [string, string, string, Tag][]): Block[] {
  return rows.map(([cidr, name, rfc, tag]) => {
    const parsed = parseCidr(cidr)
    if (!parsed.ok) throw new Error(`special.ts: bad block ${cidr}: ${parsed.error}`)
    const { net, hostBits } = toNet(parsed.value)
    if (hostBits) throw new Error(`special.ts: ${cidr} has host bits set`)
    return { net, cidr, name, rfc, tag }
  })
}

export const BLOCKS: Record<Family, Block[]> = { 4: build(V4), 6: build(V6) }

const inside = (block: Block, start: bigint, end: bigint) => block.net.base <= start && end <= lastOf(block.net)

/** Every block containing the address, most specific first. */
export function classify(addr: Addr): Block[] {
  return BLOCKS[addr.family]
    .filter((block) => inside(block, addr.value, addr.value))
    .sort((a, b) => b.net.prefix - a.net.prefix)
}

/** Blocks wholly inside `net` but smaller than it (what a big network spans). */
export function blocksWithin(net: Net): Block[] {
  const end = lastOf(net)
  return BLOCKS[net.family].filter((block) => block.net.prefix > net.prefix && block.net.base >= net.base && lastOf(block.net) <= end)
}

export interface Embedded {
  label: string
  value: string
}

const SCOPES: Record<number, string> = {
  0x1: 'interface-local', 0x2: 'link-local', 0x3: 'realm-local', 0x4: 'admin-local',
  0x5: 'site-local', 0x8: 'organization-local', 0xe: 'global',
}

/** IPv4 addresses and fields carried inside an IPv6 address by the blocks above. */
export function embedded(addr: Addr): Embedded[] {
  if (addr.family !== 6) return []
  const v = addr.value
  const low32 = formatIPv4(v & 0xffffffffn)
  const out: Embedded[] = []
  if (v >> 32n === 0xffffn) out.push({ label: 'IPv4 (mapped)', value: low32 })
  if (v >> 32n === 0x64ff9bn << 64n) out.push({ label: 'IPv4 (NAT64)', value: low32 })
  if (v >> 112n === 0x2002n) out.push({ label: 'IPv4 (6to4)', value: formatIPv4((v >> 80n) & 0xffffffffn) })
  if (v >> 96n === 0x20010000n) {
    // RFC 4380 §4: server IPv4, flags, then port and client IPv4 both inverted.
    out.push({ label: 'Teredo server', value: formatIPv4((v >> 64n) & 0xffffffffn) })
    out.push({ label: 'Teredo client', value: formatIPv4((v & 0xffffffffn) ^ 0xffffffffn) })
    out.push({ label: 'Teredo port', value: String(Number((v >> 32n) & 0xffffn) ^ 0xffff) })
    out.push({ label: 'Teredo flags', value: `0x${((v >> 48n) & 0xffffn).toString(16).padStart(4, '0')}` })
  }
  if (v >> 120n === 0xffn) {
    const flags = Number((v >> 116n) & 0xfn)
    const scope = Number((v >> 112n) & 0xfn)
    out.push({ label: 'Multicast scope', value: `${scope.toString(16)} · ${SCOPES[scope] ?? (scope === 0 || scope === 0xf ? 'reserved' : 'unassigned')}` })
    out.push({ label: 'Multicast flags', value: `${flags.toString(2).padStart(4, '0')}${flags & 1 ? ' · transient (T)' : ' · well-known'}${flags & 2 ? ' · prefix-based (P)' : ''}${flags & 4 ? ' · embedded RP (R)' : ''}` })
  }
  return out
}

/** A short verdict for the address: the most specific block, or the default. */
export function summaryTag(addr: Addr, blocks: Block[]): { tag: Tag | 'public'; text: string } {
  const top = blocks.find((block) => block.tag !== 'global')
  if (top) return { tag: top.tag, text: top.name }
  if (addr.family === 4) return { tag: 'public', text: 'Public unicast — not in any special-purpose block' }
  if (blocks.length) return { tag: 'global', text: 'Global unicast — not in any special-purpose block' }
  return { tag: 'reserved', text: 'Reserved by the IETF — outside every assigned IPv6 block' }
}

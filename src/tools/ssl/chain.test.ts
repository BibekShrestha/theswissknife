import { beforeAll, describe, expect, it } from 'vitest'
import {
  certificatesFromBytes,
  checkChain,
  decodeCertificates,
  hostnameCoverage,
  matchesHostname,
  orderChain,
  parseCertificate,
  verifyIssuedBy,
} from './x509'
import {
  ascii, concat, KU, makeCert, makeKey, oid, pem, printable, sanExtension, seq, set,
  standardChain, tlv, unsignableCert, utcTime, type TestKey,
} from './testcerts'

const NOW = Date.now()
const chainOf = (...ders: Uint8Array[]) => orderChain(ders.map(parseCertificate))
const problems = (r: Awaited<ReturnType<typeof checkChain>>, i: number) => r.links[i].problems.join(' | ')

let std: Awaited<ReturnType<typeof standardChain>>
let otherRsa: TestKey
let otherEc: TestKey

beforeAll(async () => {
  std = await standardChain()
  otherRsa = await makeKey('rsa')
  otherEc = await makeKey('ec')
}, 30_000)

describe('SSL-1: every issuer in the supplied chain must be allowed to issue', () => {
  it('passes a well-formed chain', async () => {
    const r = await checkChain(chainOf(std.leaf, std.inter, std.root), NOW)
    expect(r.links.map((l) => l.problems)).toEqual([[], [], []])
    expect(r.links[0].signature?.ok).toBe(true)
    expect(r.links[1].signature?.ok).toBe(true)
    expect(r.status).toBe('ok')
  })

  it('fails a CA:FALSE intermediate without keyCertSign', async () => {
    const inter = await makeCert({ subject: 'Test Intermediate', issuer: 'Test Root', key: std.interKey, signer: std.rootKey, ca: false, keyUsage: [KU.digitalSignature] })
    const r = await checkChain(chainOf(std.leaf, inter, std.root), NOW)
    expect(problems(r, 1)).toMatch(/not a CA/i)
    expect(problems(r, 1)).toMatch(/keyCertSign/)
    expect(r.links[0].signature?.ok).toBe(true) // the signature itself is fine
    expect(r.status).toBe('bad')
  })

  it('fails an expired intermediate', async () => {
    const inter = await makeCert({ subject: 'Test Intermediate', issuer: 'Test Root', key: std.interKey, signer: std.rootKey, ca: true, keyUsage: [KU.keyCertSign], notBefore: new Date('2020-01-01T00:00:00Z'), notAfter: new Date('2021-01-01T00:00:00Z') })
    const r = await checkChain(chainOf(std.leaf, inter, std.root), NOW)
    expect(problems(r, 1)).toMatch(/expired/i)
    expect(r.status).toBe('bad')
  })

  it('fails an EC root without basicConstraints CA:TRUE', async () => {
    const root = await makeCert({ subject: 'EC Root', key: otherEc })
    const leaf = await makeCert({ subject: 'www.example.com', issuer: 'EC Root', key: std.leafKey, signer: otherEc, dns: ['www.example.com'] })
    const r = await checkChain(chainOf(leaf, root), NOW)
    expect(r.links[0].signature?.ok).toBe(true)
    expect(problems(r, 1)).toMatch(/not a CA/i)
    expect(r.status).toBe('bad')
  })

  it('enforces pathLenConstraint', async () => {
    const root = await makeCert({ subject: 'Test Root', key: std.rootKey, ca: true, pathLen: 0, keyUsage: [KU.keyCertSign] })
    const r = await checkChain(chainOf(std.leaf, std.inter, root), NOW)
    expect(problems(r, 2)).toMatch(/path length/i)
    expect(r.status).toBe('bad')
  })

  it('requires the child issuer name to equal the parent subject name', async () => {
    const leaf = await makeCert({ subject: 'www.example.com', issuer: 'Someone Else', key: std.leafKey, signer: std.interKey, dns: ['www.example.com'] })
    const r = await checkChain(chainOf(leaf, std.inter, std.root), NOW)
    expect(problems(r, 0)).toMatch(/issuer name/i)
    expect(r.status).toBe('bad')
  })

  it('compares names case- and space-insensitively across string types', async () => {
    const issuer = seq(set(seq(oid('2.5.4.3'), printable('TEST   intermediate'))))
    const leaf = await makeCert({ subject: 'www.example.com', issuer, key: std.leafKey, signer: std.interKey, dns: ['www.example.com'] })
    const r = await checkChain([parseCertificate(leaf), parseCertificate(std.inter), parseCertificate(std.root)], NOW)
    expect(problems(r, 0)).toBe('')
  })

  it('fails a CA whose keyUsage omits keyCertSign', async () => {
    const inter = await makeCert({ subject: 'Test Intermediate', issuer: 'Test Root', key: std.interKey, signer: std.rootKey, ca: true, keyUsage: [KU.digitalSignature, KU.cRLSign] })
    const r = await checkChain(chainOf(std.leaf, inter, std.root), NOW)
    expect(problems(r, 1)).toMatch(/keyCertSign/)
  })
})

describe('SSL-2: signatures that were checked vs not checked', () => {
  it('verifies an RSA-PSS signature', async () => {
    const leaf = await makeCert({ subject: 'pss.example', issuer: 'Test Root', key: std.leafKey, signer: std.rootKey, alg: 'rsa-pss-sha256' })
    expect(await verifyIssuedBy(parseCertificate(leaf), parseCertificate(std.root))).toMatchObject({ ok: true })
    const forged = await makeCert({ subject: 'pss.example', issuer: 'Test Root', key: std.leafKey, signer: otherRsa, alg: 'rsa-pss-sha256' })
    expect(await verifyIssuedBy(parseCertificate(forged), parseCertificate(std.root))).toMatchObject({ ok: false })
  })

  it('treats a key-type mismatch as not signed by that issuer', async () => {
    const ecSigned = await makeCert({ subject: 'a.example', issuer: 'Test Root', key: std.leafKey, signer: otherEc })
    const rsaSigned = await makeCert({ subject: 'b.example', issuer: 'Test Intermediate', key: std.leafKey, signer: otherRsa })
    expect(await verifyIssuedBy(parseCertificate(ecSigned), parseCertificate(std.root))).toMatchObject({ ok: false, reason: expect.stringMatching(/RSA key/) })
    expect(await verifyIssuedBy(parseCertificate(rsaSigned), parseCertificate(std.inter))).toMatchObject({ ok: false, reason: expect.stringMatching(/EC key/) })
  })

  it('summarises an unchecked signature as unchecked, not invalid', async () => {
    const leaf = unsignableCert({ subject: 'dsa.example', issuer: 'Test Intermediate', key: std.leafKey })
    const r = await checkChain(chainOf(leaf, std.inter, std.root), NOW)
    expect(r.links[0].signature?.ok).toBeNull()
    expect(r.status).toBe('unchecked')
  })
})

describe('SSL-3: IPv6 addresses compare as bytes', () => {
  const v6 = Uint8Array.of(0x20, 0x01, 0x0d, 0xb8, ...new Array(11).fill(0), 1)

  it('displays SAN IPs in compressed form and matches any spelling', async () => {
    const cert = parseCertificate(await makeCert({ subject: 'ip', key: std.leafKey, signer: std.interKey, issuer: 'Test Intermediate', ips: [v6, Uint8Array.of(192, 0, 2, 1)] }))
    expect(cert.ipAddresses).toEqual(['2001:db8::1', '192.0.2.1'])
    for (const host of ['2001:db8::1', '2001:0DB8:0000:0000:0000:0000:0000:0001', '2001:db8:0:0::1', '[2001:db8::1]:443', 'https://[2001:db8::1]:8443/path']) {
      expect(matchesHostname(host, [], cert.ipAddresses), host).toBe(true)
    }
    expect(matchesHostname('2001:db8::2', [], cert.ipAddresses)).toBe(false)
    expect(matchesHostname('::ffff:192.0.2.1', [], cert.ipAddresses)).toBe(false)
    expect(matchesHostname('https://192.0.2.1:8443/', [], cert.ipAddresses)).toBe(true)
  })
})

describe('SSL-4: no Common Name fallback', () => {
  it('does not cover a host named only in the CN', async () => {
    const cnOnly = parseCertificate(await makeCert({ subject: 'www.example.com', key: std.leafKey }))
    const cov = hostnameCoverage(cnOnly, 'www.example.com')
    expect(cov?.ok).toBe(false)
    expect(cov?.detail).toMatch(/Common Name/)
    const ipOnly = parseCertificate(await makeCert({ subject: 'www.example.com', key: std.leafKey, ips: [Uint8Array.of(192, 0, 2, 1)] }))
    expect(hostnameCoverage(ipOnly, 'www.example.com')?.ok).toBe(false)
    expect(hostnameCoverage(ipOnly, '192.0.2.1')?.ok).toBe(true)
    expect(hostnameCoverage(ipOnly, '')).toBeNull()
  })
})

describe('SSL-5: wildcard limits', () => {
  it('rejects wildcards over a single-label suffix and empty labels', () => {
    expect(matchesHostname('example.com', ['*.com'])).toBe(false)
    expect(matchesHostname('a..example.com', ['*..example.com'])).toBe(false)
    expect(matchesHostname('.example.com', ['*.example.com'])).toBe(false)
    expect(matchesHostname('api.example.com', ['*.example.com'])).toBe(true)
  })
})

describe('SSL-6: strict parsing and algorithm checks', () => {
  it('rejects non-minimal DER lengths', () => {
    const der = std.leaf
    expect(der[1]).toBe(0x82)
    const padded = concat([Uint8Array.of(0x30, 0x83, 0x00), der.slice(2)])
    expect(() => parseCertificate(padded)).toThrow(/DER/)
  })

  it('rejects a repeated extension', async () => {
    const der = await makeCert({ subject: 'dup', key: std.leafKey, dns: ['a.example'], extensions: [sanExtension(['b.example'])] })
    expect(() => parseCertificate(der)).toThrow(/more than once/)
  })

  it('rejects impossible dates and reads GeneralizedTime years literally', async () => {
    const bad = await makeCert({ subject: 'd', key: std.leafKey, validity: seq(tlv(0x17, ascii('210230000000Z')), utcTime(new Date(NOW + 86_400_000))) })
    expect(() => parseCertificate(bad)).toThrow(/date/)
    const early = await makeCert({ subject: 'd', key: std.leafKey, validity: seq(tlv(0x18, ascii('00500101000000Z')), tlv(0x18, ascii('99991231235959Z'))) })
    expect(parseCertificate(early).notBefore.getUTCFullYear()).toBe(50)
  })

  it('fails when the outer and TBS signature algorithms differ', async () => {
    const leaf = await makeCert({ subject: 'x', issuer: 'Test Root', key: std.leafKey, signer: std.rootKey, tbsAlg: 'rsa-sha1' })
    const r = await checkChain(chainOf(leaf, std.root), NOW)
    expect(problems(r, 0)).toMatch(/algorithm/)
    expect(r.status).toBe('bad')
  })

  it('flags SHA-1 signatures below the root, but not the root self-signature', async () => {
    const root = await makeCert({ subject: 'Test Root', key: std.rootKey, ca: true, keyUsage: [KU.keyCertSign], alg: 'rsa-sha1' })
    const leaf = await makeCert({ subject: 'x', issuer: 'Test Root', key: std.leafKey, signer: std.rootKey, alg: 'rsa-sha1' })
    const r = await checkChain(chainOf(leaf, root), NOW)
    expect(r.links[0].signature?.ok).toBe(true)
    expect(problems(r, 0)).toMatch(/SHA-1/)
    expect(problems(r, 1)).toBe('')
    expect(r.status).toBe('bad')
  })

  it('decides "self-signed root" by the signature, not the name', async () => {
    const fake = await makeCert({ subject: 'Test Root', key: std.rootKey, signer: otherRsa, ca: true, keyUsage: [KU.keyCertSign] })
    const r = await checkChain(chainOf(std.leaf, std.inter, fake), NOW)
    expect(r.links[2].role).not.toBe('root')
    expect(problems(r, 2)).toMatch(/self-signature/i)
    const real = await checkChain(chainOf(std.leaf, std.inter, std.root), NOW)
    expect(real.links[2].role).toBe('root')
  })
})

describe('SSL-7: input formats', () => {
  it('reads -----BEGIN TRUSTED CERTIFICATE----- (OpenSSL trust info appended)', () => {
    const aux = seq(seq(oid('1.3.6.1.5.5.7.3.1')))
    const text = pem(concat([std.root, aux]), 'TRUSTED CERTIFICATE')
    expect(decodeCertificates(text)).toEqual([std.root])
    expect(certificatesFromBytes(new TextEncoder().encode(text))).toEqual([std.root])
  })

  it('reads DER bytes and PEM bytes', () => {
    expect(certificatesFromBytes(std.leaf)).toEqual([std.leaf])
    expect(certificatesFromBytes(new TextEncoder().encode(pem(std.leaf) + pem(std.inter)))).toEqual([std.leaf, std.inter])
  })
})

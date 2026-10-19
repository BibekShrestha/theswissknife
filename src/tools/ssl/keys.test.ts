import { describe, expect, it } from 'vitest'
import { fromBase64, hex, toBase64 } from './der'
import { md5 } from './md5'
import { parseCsr, verifyCsr } from './csr'
import { fileToText, removeRanges, scanText, sniffDer, type Block } from './inputs'
import { finishKey, parseKeyBlock, parseSshPublicLine, type KeyReport } from './keys'
import { fingerprints, parseSshBlob, sameKey, type PublicKey } from './spki'
import { parseCertificate } from './x509'
import { concat, pem, seq, tlv } from './testcerts'

// Throwaway keys made by fixtures/generate.sh (OpenSSL 3 + ssh-keygen) for these tests only.
const raw = import.meta.glob('./fixtures/test-*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const fixture = (name: string): string => {
  const text = raw[`./fixtures/${name}`]
  if (text === undefined) throw new Error(`missing fixture ${name}`)
  return text
}
const table = (name: string) => Object.fromEntries(fixture(name).trim().split('\n').map((line) => {
  const [key, ...values] = line.split(' ')
  return [key, values]
}))
const PINS = table('test-pins.txt')
const SSH_FP = table('test-ssh-fingerprints.txt')

const pemBody = (text: string) => fromBase64(text.replace(/-----[^-]+-----/g, ''), 'fixture')

function only(text: string): Block {
  const { blocks } = scanText(text)
  expect(blocks).toHaveLength(1)
  return blocks[0]
}

async function key(text: string): Promise<KeyReport> {
  const block = only(text)
  if (block.kind === 'error') throw new Error(block.error)
  if (block.kind !== 'key') throw new Error(`expected a key, got ${block.kind}`)
  return finishKey(block.parsed)
}

async function fp(publicKey: PublicKey | null) {
  expect(publicKey).not.toBeNull()
  return fingerprints(publicKey!)
}

describe('MD5 (RFC 1321 §A.5 test suite)', () => {
  const vectors: [string, string][] = [
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['a', '0cc175b9c0f1b6a831c399e269772661'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
    ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
    ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 'd174ab98d277d9f5a5611c2c9f419d9f'],
    ['1234567890'.repeat(8), '57edf4a22be3c955ac49da2e2107b67a'],
  ]
  it.each(vectors)('md5(%j)', (input, expected) => {
    expect(hex(md5(new TextEncoder().encode(input))).toLowerCase()).toBe(expected)
  })
  it('handles inputs around the 56-byte padding boundary', () => {
    // 55, 56 and 64 bytes cross the one-block / two-block padding edge
    expect(hex(md5(new Uint8Array(55))).toLowerCase()).toBe('c9ea3314b91c9fd4e38f9432064fd1f2')
    expect(hex(md5(new Uint8Array(56))).toLowerCase()).toBe('e3c4dd21a9171fd39d208efa09bf7883')
    expect(hex(md5(new Uint8Array(64))).toLowerCase()).toBe('3b5d3c7d207e37dceeedd301e35e2e58')
  })
})

describe('private keys in OpenSSL formats', () => {
  it('reads RSA PKCS#8 and PKCS#1 as the same 2048-bit key with OpenSSL\'s SPKI pin', async () => {
    for (const [file, format] of [['test-rsa.pkcs8.pem', 'PKCS#8'], ['test-rsa.pkcs1.pem', 'PKCS#1 (RSA PRIVATE KEY)']]) {
      const report = await key(fixture(file))
      expect(report).toMatchObject({ kind: 'private', format })
      expect(report.publicKey).toMatchObject({ algorithm: 'RSA', detail: '2048-bit RSA', bits: 2048 })
      expect((await fp(report.publicKey)).spkiPin).toBe(PINS.rsa[0])
    }
  })

  it('gives the PEM RSA key the same OpenSSH fingerprints ssh-keygen prints for it', async () => {
    const report = await key(fixture('test-rsa.pkcs1.pem'))
    const prints = await fp(report.publicKey)
    expect(prints.sshSha256).toBe(SSH_FP['test-rsa.ssh'][0])
    expect(prints.sshMd5).toBe(SSH_FP['test-rsa.ssh'][1])
  })

  it('reads EC keys as PKCS#8 and SEC1, deriving a public point the file left out', async () => {
    for (const file of ['test-p256.pkcs8.pem', 'test-p256.sec1.pem', 'test-p256.sec1-nopub.pem']) {
      const report = await key(fixture(file))
      expect(report.kind).toBe('private')
      expect(report.publicKey).toMatchObject({ algorithm: 'EC', detail: 'P-256 elliptic curve', curve: 'P-256' })
      expect((await fp(report.publicKey)).spkiPin).toBe(PINS.p256[0])
    }
    const nopub = await key(fixture('test-p256.sec1-nopub.pem'))
    expect(nopub.notes.join(' ')).toMatch(/derived in this browser/)
    const p384 = await key(fixture('test-p384.pkcs8.pem'))
    expect(p384.publicKey?.detail).toBe('P-384 elliptic curve')
    expect((await fp(p384.publicKey)).spkiPin).toBe(PINS.p384[0])
  })

  it('derives Ed25519 and X25519 public keys from PKCS#8 seeds', async () => {
    const ed = await key(fixture('test-ed25519.pkcs8.pem'))
    expect(ed.publicKey?.algorithm).toBe('Ed25519')
    expect((await fp(ed.publicKey)).spkiPin).toBe(PINS.ed25519[0])
    const x = await key(fixture('test-x25519.pkcs8.pem'))
    // X25519 support differs by engine; when present the pin must be right
    if (x.publicKey) expect((await fp(x.publicKey)).spkiPin).toBe(PINS.x25519[0])
    else expect(x.notes.join(' ')).toMatch(/could not derive/)
  })

  it('keeps no private numbers in the report', async () => {
    const pkcs8 = pemBody(fixture('test-rsa.pkcs8.pem'))
    const imported = await crypto.subtle.importKey('pkcs8', pkcs8 as BufferSource, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, true, ['sign'])
    const jwk = await crypto.subtle.exportKey('jwk', imported)
    const secrets = [jwk.d, jwk.p, jwk.q, jwk.dp, jwk.dq, jwk.qi].map((v) => hex(fromBase64(v!.replace(/-/g, '+').replace(/_/g, '/'), 'jwk')))
    const dump = (report: KeyReport) => JSON.stringify(report, (_, value) => (value instanceof Uint8Array ? hex(value) : value))
    for (const file of ['test-rsa.pkcs8.pem', 'test-rsa.pkcs1.pem']) {
      const text = dump(await key(fixture(file)))
      for (const secret of secrets) expect(text).not.toContain(secret)
    }
    const seed = hex(pemBody(fixture('test-ed25519.pkcs8.pem')).slice(-32))
    expect(dump(await key(fixture('test-ed25519.pkcs8.pem')))).not.toContain(seed)
  })
})

describe('encrypted private keys are described, never decrypted', () => {
  it('names PBES2 with PBKDF2 and its parameters', async () => {
    const report = await key(fixture('test-rsa.encrypted-pbkdf2.pem'))
    expect(report).toMatchObject({ kind: 'private', format: 'PKCS#8, encrypted', publicKey: null })
    expect(report.encryption).toBe('PBES2 · PBKDF2-HMAC-SHA-256, 4,096 iterations · AES-256-CBC')
  })

  it('names PBES2 with scrypt', async () => {
    expect((await key(fixture('test-rsa.encrypted-scrypt.pem'))).encryption).toBe('PBES2 · scrypt N=16,384, r=8, p=1 · AES-256-CBC')
  })

  it('reports Proc-Type: 4,ENCRYPTED and warns about its MD5 key derivation', async () => {
    const report = await key(fixture('test-rsa.legacy-encrypted.pem'))
    expect(report.encryption).toBe('OpenSSL legacy PEM encryption · AES-128-CBC')
    expect(report.warnings.join(' ')).toMatch(/MD5/)
    expect(report.publicKey).toBeNull()
  })

  it('reads the public half of a passphrase-protected OpenSSH key', async () => {
    const report = await key(fixture('test-ssh-ed25519-encrypted.key'))
    expect(report.encryption).toBe('bcrypt KDF, 16 rounds · aes256-ctr')
    expect(report.comment).toBeUndefined()
    expect((await fp(report.publicKey)).sshSha256).toBe(SSH_FP['test-ssh-ed25519-encrypted'][0])
  })
})

describe('public keys', () => {
  it('reads SPKI and PKCS#1 public keys', async () => {
    const spki = await key(fixture('test-rsa.spki.pem'))
    expect(spki).toMatchObject({ kind: 'public', format: 'SubjectPublicKeyInfo (PUBLIC KEY)' })
    expect((await fp(spki.publicKey)).spkiPin).toBe(PINS.rsa[0])
    const pkcs1 = await key(fixture('test-rsa.pkcs1-public.pem'))
    expect(pkcs1.format).toBe('PKCS#1 (RSA PUBLIC KEY)')
    expect((await fp(pkcs1.publicKey)).spkiPin).toBe(PINS.rsa[0])
    expect((await fp((await key(fixture('test-ed25519.spki.pem'))).publicKey)).spkiPin).toBe(PINS.ed25519[0])
    expect((await fp((await key(fixture('test-p256.spki.pem'))).publicKey)).spkiPin).toBe(PINS.p256[0])
  })

  it('matches ssh-keygen\'s SHA256 and MD5 fingerprints for OpenSSH public and private keys', async () => {
    for (const name of ['test-ssh-ed25519', 'test-ssh-rsa', 'test-ssh-ecdsa', 'test-rsa.ssh']) {
      const [sha, md] = SSH_FP[name]
      const pub = await key(fixture(`${name}.pub`))
      expect(pub).toMatchObject({ kind: 'public', format: 'OpenSSH public key', comment: 'test-key' })
      expect(await fp(pub.publicKey)).toMatchObject({ sshSha256: sha, sshMd5: md })
      if (name === 'test-rsa.ssh') continue
      const priv = await key(fixture(`${name}.key`))
      expect(priv).toMatchObject({ kind: 'private', format: 'OpenSSH private key', comment: 'test-key' })
      expect(sameKey(priv.publicKey, pub.publicKey)).toBe(true)
    }
    const ecdsa = await key(fixture('test-ssh-ecdsa.pub'))
    expect(ecdsa.publicKey).toMatchObject({ algorithm: 'EC', detail: 'P-256 elliptic curve' })
  })

  it('reads RFC 4716 SSH2 blocks, including a continued Comment header', async () => {
    const report = await key(fixture('test-ssh-ed25519.rfc4716.pub'))
    expect(report.comment).toBe('test-key, a long comment that continues on a second line')
    expect((await fp(report.publicKey)).sshSha256).toBe(SSH_FP['test-ssh-ed25519'][0])
  })

  it('accepts authorized_keys options before the key type', async () => {
    const report = await key(`from="192.0.2.0/24",no-pty ${fixture('test-ssh-ed25519.pub').trim()}`)
    expect(report.notes.join(' ')).toMatch(/options/)
    expect((await fp(report.publicKey)).sshSha256).toBe(SSH_FP['test-ssh-ed25519'][0])
  })
})

describe('CSRs (PKCS#10)', () => {
  it('reads subject, key and requested extensions, and verifies proof of possession', async () => {
    const csr = parseCsr(pemBody(fixture('test-rsa.csr.pem')))
    expect(csr.subject.display).toBe('CN=test.example, O=Test Fixture')
    expect(csr.publicKey.detail).toBe('2048-bit RSA')
    expect(csr.signatureAlgorithm).toBe('SHA-256 with RSA')
    expect(csr.extensions).toMatchObject({
      sans: ['test.example', '*.test.example'],
      ipAddresses: ['192.0.2.7'],
      keyUsage: ['Digital signature', 'Key encipherment'],
      extendedKeyUsage: ['TLS web server authentication'],
    })
    expect(await verifyCsr(csr)).toEqual({ ok: true, reason: 'Signature valid' })
  })

  it.each(['test-p256.csr.pem', 'test-ed25519.csr.pem', 'test-rsa-pss.csr.pem'])('verifies %s', async (file) => {
    const csr = parseCsr(pemBody(fixture(file)))
    expect((await verifyCsr(csr)).ok).toBe(true)
  })

  it('names RSA-PSS parameters and an empty attribute set', () => {
    const csr = parseCsr(pemBody(fixture('test-rsa-pss.csr.pem')))
    expect(csr.signatureAlgorithm).toBe('RSA-PSS with SHA-256')
    expect(csr.extensions).toBeNull()
    expect(csr.attributes).toEqual([])
  })

  it('fails proof of possession when the signature was tampered with', async () => {
    const der = pemBody(fixture('test-rsa.csr.pem'))
    der[der.length - 5] ^= 0x01
    expect(await verifyCsr(parseCsr(der))).toMatchObject({ ok: false, reason: expect.stringMatching(/own public key/) })
  })

  it('fails proof of possession when the request info was changed after signing', async () => {
    const der = pemBody(fixture('test-rsa.csr.pem'))
    const at = new TextDecoder('latin1').decode(der).indexOf('test.example')
    der[at] = 'b'.charCodeAt(0)
    const csr = parseCsr(der)
    expect(csr.subject.display).toContain('best.example')
    expect((await verifyCsr(csr)).ok).toBe(false)
  })

  it('accepts the NEW CERTIFICATE REQUEST label and DER files', () => {
    const text = fixture('test-p256.csr.pem').replace(/CERTIFICATE REQUEST/g, 'NEW CERTIFICATE REQUEST')
    expect(only(text)).toMatchObject({ kind: 'csr', label: 'NEW CERTIFICATE REQUEST' })
    const der = pemBody(fixture('test-rsa.csr.pem'))
    expect(sniffDer(der)).toBe('CERTIFICATE REQUEST')
    expect(fileToText(der)).toContain('-----BEGIN CERTIFICATE REQUEST-----')
  })
})

describe('matching keys, CSRs and certificates', () => {
  it('matches the same key across every format, and not a different one', async () => {
    const cert = parseCertificate(pemBody(fixture('test-rsa.cert.pem')))
    const other = parseCertificate(pemBody(fixture('test-p256.cert.pem')))
    const csr = parseCsr(pemBody(fixture('test-rsa.csr.pem')))
    expect(sameKey(cert.publicKey, csr.publicKey)).toBe(true)
    expect(sameKey(other.publicKey, csr.publicKey)).toBe(false)
    for (const file of ['test-rsa.pkcs8.pem', 'test-rsa.pkcs1.pem', 'test-rsa.spki.pem', 'test-rsa.pkcs1-public.pem', 'test-rsa.ssh.pub']) {
      const report = await key(fixture(file))
      expect(sameKey(report.publicKey, cert.publicKey), file).toBe(true)
      expect(sameKey(report.publicKey, other.publicKey), file).toBe(false)
    }
    expect(sameKey((await key(fixture('test-p256.sec1-nopub.pem'))).publicKey, other.publicKey)).toBe(true)
    // the certificate's own SPKI pin equals the key's
    expect((await fingerprints(cert.publicKey)).spkiPin).toBe(PINS.rsa[0])
  })

  it('cannot compare an encrypted PKCS#8 key (its public key is inside the ciphertext)', async () => {
    const cert = parseCertificate(pemBody(fixture('test-rsa.cert.pem')))
    expect(sameKey((await key(fixture('test-rsa.encrypted-pbkdf2.pem'))).publicKey, cert.publicKey)).toBe(false)
  })
})

describe('scanning pasted text', () => {
  it('classifies a mixed paste in order and locates private keys for removal', () => {
    const text = [fixture('test-rsa.cert.pem'), fixture('test-rsa.pkcs8.pem'), fixture('test-rsa.csr.pem'), fixture('test-ssh-ed25519.pub'), fixture('test-ssh-ed25519.key')].join('\n')
    const scan = scanText(text)
    expect(scan.blocks.map((block) => block.kind)).toEqual(['certificate', 'key', 'csr', 'key', 'key'])
    expect(scan.blocks.filter((block) => block.kind === 'key' && block.private)).toHaveLength(2)
    const cleaned = removeRanges(text, scan.privateRanges)
    expect(cleaned).not.toMatch(/PRIVATE KEY/)
    expect(scanText(cleaned).blocks.map((block) => block.kind)).toEqual(['certificate', 'csr', 'key'])
  })

  it('skips EC PARAMETERS and reports unsupported blocks without failing the rest', () => {
    const params = '-----BEGIN EC PARAMETERS-----\nBggqhkjOPQMBBw==\n-----END EC PARAMETERS-----\n'
    const scan = scanText(params + fixture('test-p256.sec1.pem'))
    expect(scan.blocks.map((block) => block.kind)).toEqual(['ignored', 'key'])
  })
})

describe('malformed and truncated input', () => {
  const errorOf = (text: string) => {
    const block = only(text)
    if (block.kind !== 'error') throw new Error(`expected an error, got ${block.kind}`)
    return block.error
  }

  it('reports a block with no END line', () => {
    const text = fixture('test-rsa.pkcs8.pem').replace(/-----END PRIVATE KEY-----\s*$/, '')
    expect(errorOf(text)).toMatch(/no END line/)
    // …and a following block is still read
    const scan = scanText(text + '\n' + fixture('test-rsa.spki.pem'))
    expect(scan.blocks.map((block) => block.kind)).toEqual(['error', 'key'])
    expect(scan.privateRanges).toHaveLength(1)
  })

  it.each([
    'test-rsa.pkcs8.pem', 'test-rsa.pkcs1.pem', 'test-p256.sec1.pem', 'test-ed25519.pkcs8.pem', 'test-rsa.spki.pem',
    'test-rsa.encrypted-pbkdf2.pem', 'test-ssh-ed25519.key', 'test-ssh-rsa.key', 'test-rsa.csr.pem',
  ])('refuses %s cut short', (file) => {
    const text = fixture(file)
    const label = text.match(/-----BEGIN ([A-Z ]+)-----/)![1]
    const bytes = pemBody(text)
    // keep BEGIN/END, drop the last 10 bytes: the structure is truncated
    for (const cut of [bytes.slice(0, bytes.length - 10), bytes.slice(0, 1)]) {
      const block = only(pem(cut, label))
      if (block.kind === 'csr') expect(() => parseCsr(cut)).toThrow()
      else expect(block.kind).toBe('error')
    }
  })

  it('refuses non-minimal DER lengths, non-minimal integers and trailing bytes', () => {
    const der = pemBody(fixture('test-ed25519.pkcs8.pem'))
    // re-encode the outer SEQUENCE length in long form (0x30 0x81 0x2e instead of 0x30 0x2e)
    expect(der[1]).toBeLessThan(0x80)
    const longForm = concat([Uint8Array.of(0x30, 0x81, der[1]), der.slice(2)])
    expect(errorOf(pem(longForm, 'PRIVATE KEY'))).toMatch(/non-minimal length/)
    // version INTEGER 0 written as 00 00
    const paddedInt = seq(Uint8Array.of(0x02, 0x02, 0x00, 0x00), der.slice(5))
    expect(errorOf(pem(paddedInt, 'PRIVATE KEY'))).toMatch(/non-minimal INTEGER/)
    expect(errorOf(pem(concat([der, Uint8Array.of(0)]), 'PRIVATE KEY'))).toMatch(/trailing bytes/)
  })

  it('refuses a negative RSA modulus and a public key with unused bits', () => {
    const negative = seq(tlv(0x02, Uint8Array.of(0x81, 0x01)), tlv(0x02, Uint8Array.of(3)))
    expect(errorOf(pem(negative, 'RSA PUBLIC KEY'))).toMatch(/negative/)
    const spki = pemBody(fixture('test-ed25519.spki.pem'))
    spki[spki.length - 33] = 1 // the BIT STRING's unused-bits byte
    expect(errorOf(pem(spki, 'PUBLIC KEY'))).toMatch(/unused bits/)
  })

  it('refuses invalid Base64 without quoting it', () => {
    const text = '-----BEGIN PRIVATE KEY-----\nMIIB*not-base64*\n-----END PRIVATE KEY-----'
    const error = errorOf(text)
    expect(error).toMatch(/invalid Base64/)
    expect(error).not.toContain('not-base64')
  })

  it('refuses OpenSSH keys whose halves disagree or whose blobs are cut', () => {
    const blob = pemBody(fixture('test-ssh-ed25519.key'))
    const other = pemBody(fixture('test-ssh-rsa.key'))
    // corrupt the first check value inside the private section
    const corrupt = blob.slice()
    const marker = new TextEncoder().encode('ssh-ed25519')
    const second = (() => {
      let seen = 0
      for (let i = 0; i < corrupt.length; i += 1) {
        if (marker.every((byte, j) => corrupt[i + j] === byte) && ++seen === 2) return i
      }
      return -1
    })()
    expect(second).toBeGreaterThan(0)
    corrupt[second - 12] ^= 0xff // 4-byte length + 8 bytes of check values precede the type
    expect(errorOf(pem(corrupt, 'OPENSSH PRIVATE KEY'))).toMatch(/check values differ|corrupt/)
    expect(errorOf(pem(other.slice(0, 120), 'OPENSSH PRIVATE KEY'))).toMatch(/truncated/)
    expect(errorOf(pem(new TextEncoder().encode('openssh-key-v0\0'), 'OPENSSH PRIVATE KEY'))).toMatch(/openssh-key-v1/)
  })

  it('refuses an OpenSSH line whose type does not match its blob, and a cut blob', () => {
    const [, b64] = fixture('test-ssh-ed25519.pub').split(' ')
    expect(() => parseSshPublicLine(`ssh-rsa ${b64}`)).toThrow(/says ssh-rsa/)
    const cut = toBase64(fromBase64(b64, 'x').slice(0, 30))
    expect(() => parseSshPublicLine(`ssh-ed25519 ${cut}`)).toThrow(/truncated/)
    expect(() => parseSshBlob(concat([fromBase64(b64, 'x'), Uint8Array.of(0)]))).toThrow(/trailing/)
  })

  it('refuses an unknown PEM key label via parseKeyBlock, and unknown files', () => {
    expect(() => parseKeyBlock('SECRET KEY', new Uint8Array(4))).toThrow(/not supported/)
    expect(() => fileToText(Uint8Array.of(1, 2, 3, 4))).toThrow(/not a certificate, CSR or key/)
  })

  it('refuses a CSR with a version other than 1 or the wrong number of fields', () => {
    const der = pemBody(fixture('test-p256.csr.pem'))
    const info = parseCsr(der)
    expect(info.publicKey.algorithm).toBe('EC')
    const tampered = der.slice()
    // the version INTEGER is the first thing in the request info: 30 82 xx xx 30 81 xx 02 01 00
    const at = tampered.findIndex((byte, i) => byte === 0x02 && tampered[i + 1] === 0x01 && tampered[i + 2] === 0x00)
    tampered[at + 2] = 0x02
    expect(() => parseCsr(tampered)).toThrow(/version/)
    expect(() => parseCsr(seq(seq(), seq()))).toThrow(/PKCS#10/)
  })
})

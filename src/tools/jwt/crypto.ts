import { b64urlDecodeBytes, b64urlEncodeBytes, b64urlEncodeString } from './jwt'

/**
 * WebCrypto signing/verification for the JWS algorithms browsers can do.
 * Everything is local — keys and tokens never leave the page.
 *
 * Note: JWS ECDSA signatures are the raw r‖s concatenation, which is exactly
 * WebCrypto's ECDSA format — no DER conversion needed.
 */

export const ALGS = [
  'HS256', 'HS384', 'HS512',
  'RS256', 'RS384', 'RS512',
  'PS256', 'PS384', 'PS512',
  'ES256', 'ES384', 'ES512',
  'EdDSA',
] as const

export type Alg = (typeof ALGS)[number]

export const isHmac = (alg: Alg) => alg.startsWith('HS')

const HASH: Record<string, string> = { '256': 'SHA-256', '384': 'SHA-384', '512': 'SHA-512' }
const CURVE: Record<string, string> = { '256': 'P-256', '384': 'P-384', '512': 'P-521' }

interface AlgSpec {
  importParams: RsaHashedImportParams | EcKeyImportParams | HmacImportParams | { name: string }
  signParams: AlgorithmIdentifier | RsaPssParams | EcdsaParams
}

function spec(alg: Alg): AlgSpec {
  const bits = alg.slice(2)
  if (alg.startsWith('HS')) {
    return { importParams: { name: 'HMAC', hash: HASH[bits] }, signParams: 'HMAC' }
  }
  if (alg.startsWith('RS')) {
    return {
      importParams: { name: 'RSASSA-PKCS1-v1_5', hash: HASH[bits] },
      signParams: 'RSASSA-PKCS1-v1_5',
    }
  }
  if (alg.startsWith('PS')) {
    return {
      importParams: { name: 'RSA-PSS', hash: HASH[bits] },
      signParams: { name: 'RSA-PSS', saltLength: Number(bits) / 8 },
    }
  }
  if (alg.startsWith('ES')) {
    return {
      importParams: { name: 'ECDSA', namedCurve: CURVE[bits] },
      signParams: { name: 'ECDSA', hash: HASH[bits] },
    }
  }
  return { importParams: { name: 'Ed25519' }, signParams: 'Ed25519' }
}

function pemToBytes(pem: string): Uint8Array {
  const body = pem.replace(/-----(BEGIN|END)[^-]+-----/g, '').replace(/\s+/g, '')
  const bin = atob(body)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function importHmacKey(secret: string, secretIsB64: boolean, alg: Alg, usage: KeyUsage) {
  const raw = secretIsB64 ? b64urlDecodeBytes(secret) : new TextEncoder().encode(secret)
  if (raw.length === 0) throw new Error('Secret is empty.')
  return crypto.subtle.importKey('raw', raw as BufferSource, spec(alg).importParams, false, [usage])
}

async function importPemOrJwk(material: string, alg: Alg, usage: 'verify' | 'sign') {
  const trimmed = material.trim()
  if (!trimmed) throw new Error(usage === 'verify' ? 'Paste a public key.' : 'Paste a private key.')
  const params = spec(alg).importParams
  if (trimmed.startsWith('{')) {
    const jwk = JSON.parse(trimmed) as JsonWebKey
    return crypto.subtle.importKey('jwk', jwk, params, false, [usage])
  }
  if (trimmed.includes('BEGIN')) {
    const bytes = pemToBytes(trimmed) as BufferSource
    if (usage === 'verify') {
      if (trimmed.includes('CERTIFICATE')) {
        throw new Error('Paste the public key (BEGIN PUBLIC KEY), not a certificate.')
      }
      return crypto.subtle.importKey('spki', bytes, params, false, ['verify'])
    }
    if (!trimmed.includes('PRIVATE')) throw new Error('Signing needs a PRIVATE key (PKCS#8).')
    return crypto.subtle.importKey('pkcs8', bytes, params, false, ['sign'])
  }
  throw new Error('Key must be PEM (-----BEGIN …-----) or a JWK JSON object.')
}

export interface KeyMaterial {
  /** HS secret, or PEM/JWK text for asymmetric algorithms. */
  text: string
  secretIsB64: boolean
}

export type VerifyResult = { state: 'valid' } | { state: 'invalid' } | { state: 'error'; message: string }

export async function verifyJws(
  alg: Alg,
  signingInput: string,
  signatureB64: string,
  key: KeyMaterial,
): Promise<VerifyResult> {
  try {
    const cryptoKey = isHmac(alg)
      ? await importHmacKey(key.text, key.secretIsB64, alg, 'verify')
      : await importPemOrJwk(key.text, alg, 'verify')
    const ok = await crypto.subtle.verify(
      spec(alg).signParams,
      cryptoKey,
      b64urlDecodeBytes(signatureB64) as BufferSource,
      new TextEncoder().encode(signingInput) as BufferSource,
    )
    return ok ? { state: 'valid' } : { state: 'invalid' }
  } catch (err) {
    return { state: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}

export async function signJws(
  alg: Alg,
  headerJson: string,
  payloadJson: string,
  key: KeyMaterial,
): Promise<string> {
  const cryptoKey = isHmac(alg)
    ? await importHmacKey(key.text, key.secretIsB64, alg, 'sign')
    : await importPemOrJwk(key.text, alg, 'sign')
  const signingInput = `${b64urlEncodeString(headerJson)}.${b64urlEncodeString(payloadJson)}`
  const sig = await crypto.subtle.sign(
    spec(alg).signParams,
    cryptoKey,
    new TextEncoder().encode(signingInput) as BufferSource,
  )
  return `${signingInput}.${b64urlEncodeBytes(new Uint8Array(sig))}`
}

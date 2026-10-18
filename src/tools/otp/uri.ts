import { decodeBase32, encodeBase32 } from './base32'
import { ALGORITHMS, DEFAULT_PERIOD, MAX_COUNTER, MAX_DIGITS, MIN_DIGITS, type Algorithm, type OtpType } from './otp'

/**
 * otpauth:// URIs, the Key Uri Format Google published for Authenticator
 * and every other app adopted:
 *   otpauth://TYPE/ISSUER:ACCOUNT?secret=BASE32&issuer=…&algorithm=…&digits=…&period=…&counter=…
 */

export interface Account {
  type: OtpType
  secret: Uint8Array
  /** The account part of the label, e.g. alice@example.com. */
  name: string
  issuer: string
  algorithm: Algorithm
  digits: number
  /** Seconds per TOTP window. */
  period: number
  /** HOTP's starting counter. */
  counter: bigint
}

export type UriResult = { account: Account; warnings: string[] } | { error: string }

const KNOWN_PARAMS = new Set(['secret', 'issuer', 'algorithm', 'digits', 'period', 'counter'])

/** Maps sha1 / SHA-256 / Sha512 onto the three names the format defines. */
export function parseAlgorithm(raw: string): Algorithm | null {
  const name = raw.trim().toUpperCase().replace(/-/g, '')
  return (ALGORITHMS as string[]).includes(name) ? (name as Algorithm) : null
}

/** Percent-decoding that leaves `+` alone (a label is a path, not a form). */
function decodeComponent(raw: string, what: string): string | { error: string } {
  try {
    return decodeURIComponent(raw)
  } catch {
    return { error: `The ${what} has a broken %-escape` }
  }
}

/** Query parameters by hand: URLSearchParams turns `+` into a space and hides duplicates. */
function readParams(query: string): Map<string, string[]> | { error: string } {
  const params = new Map<string, string[]>()
  for (const part of query.split('&')) {
    if (!part) continue
    const eq = part.indexOf('=')
    const key = decodeComponent(eq < 0 ? part : part.slice(0, eq), 'parameter name')
    const value = decodeComponent((eq < 0 ? '' : part.slice(eq + 1)).replace(/\+/g, ' '), 'parameter value')
    if (typeof key !== 'string') return key
    if (typeof value !== 'string') return { error: `The ${key} parameter has a broken %-escape` }
    const name = key.toLowerCase()
    params.set(name, [...(params.get(name) ?? []), value])
  }
  return params
}

const INTEGER = /^\d+$/

export function parseOtpauth(input: string): UriResult {
  const text = input.trim()
  const m = /^otpauth:\/\/([^/?#]*)\/?([^?#]*)(?:\?([^#]*))?(?:#.*)?$/i.exec(text)
  if (!m) {
    if (/^otpauth:/i.test(text)) return { error: 'Not an otpauth URI — expected otpauth://totp/… or otpauth://hotp/…' }
    return { error: 'Not an otpauth:// URI' }
  }
  const [, rawType, rawLabel, query = ''] = m
  const type = rawType.toLowerCase()
  if (type !== 'totp' && type !== 'hotp') {
    return { error: rawType ? `Unsupported type “${rawType}” — only totp and hotp are standard` : 'The URI has no type — expected otpauth://totp/… or otpauth://hotp/…' }
  }

  const warnings: string[] = []
  const label = decodeComponent(rawLabel, 'label')
  if (typeof label !== 'string') return label
  const params = readParams(query)
  if ('error' in params) return params as { error: string }

  for (const [name, values] of params) {
    if (values.length > 1 && KNOWN_PARAMS.has(name)) warnings.push(`${name} appears ${values.length} times — the first one is used`)
  }
  const get = (name: string) => params.get(name)?.[0]
  const unknown = [...params.keys()].filter((name) => !KNOWN_PARAMS.has(name))
  if (unknown.length) warnings.push(`Ignored parameter${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`)

  const rawSecret = get('secret')
  if (rawSecret === undefined) return { error: 'The URI has no secret parameter' }
  const secret = decodeBase32(rawSecret)
  if ('error' in secret) return { error: `secret: ${secret.error}` }

  // "Issuer:account" — the prefix is optional; the issuer parameter is preferred.
  const colon = label.indexOf(':')
  const labelIssuer = colon >= 0 ? label.slice(0, colon).trim() : ''
  const name = (colon >= 0 ? label.slice(colon + 1) : label).trim()
  const paramIssuer = get('issuer')?.trim()
  if (paramIssuer !== undefined && labelIssuer && paramIssuer !== labelIssuer) {
    warnings.push(`The issuer parameter (“${paramIssuer}”) differs from the label’s prefix (“${labelIssuer}”); the parameter is used`)
  }
  const issuer = paramIssuer ?? labelIssuer
  if (!name) warnings.push('The URI has no account name in its label')

  let algorithm: Algorithm = 'SHA1'
  const rawAlgorithm = get('algorithm')
  if (rawAlgorithm !== undefined) {
    const parsed = parseAlgorithm(rawAlgorithm)
    if (!parsed) return { error: `Unsupported algorithm “${rawAlgorithm}” — otpauth URIs use SHA1, SHA256 or SHA512` }
    algorithm = parsed
  }

  let digits = 6
  const rawDigits = get('digits')
  if (rawDigits !== undefined) {
    if (!INTEGER.test(rawDigits) || +rawDigits < MIN_DIGITS || +rawDigits > MAX_DIGITS) {
      return { error: `digits must be ${MIN_DIGITS}, 7 or ${MAX_DIGITS} — got “${rawDigits}”` }
    }
    digits = +rawDigits
  }

  let period = DEFAULT_PERIOD
  const rawPeriod = get('period')
  if (rawPeriod !== undefined) {
    if (type === 'hotp') warnings.push('period is ignored for HOTP')
    else if (!INTEGER.test(rawPeriod) || +rawPeriod < 1) return { error: `period must be a whole number of seconds, 1 or more — got “${rawPeriod}”` }
    else period = +rawPeriod
  }

  let counter = 0n
  const rawCounter = get('counter')
  if (type === 'totp') {
    if (rawCounter !== undefined) warnings.push('counter is ignored for TOTP')
  } else if (rawCounter === undefined) {
    warnings.push('No counter parameter (the format requires one for HOTP) — starting at 0')
  } else if (!INTEGER.test(rawCounter) || BigInt(rawCounter) > MAX_COUNTER) {
    return { error: `counter must be a whole number from 0 to 2^64 − 1 — got “${rawCounter}”` }
  } else {
    counter = BigInt(rawCounter)
  }

  return { account: { type, secret: secret.bytes, name, issuer, algorithm, digits, period, counter }, warnings }
}

/** Keeps `@` readable in labels, as Google's own examples do. */
const encodeLabelPart = (text: string) => encodeURIComponent(text).replace(/%40/g, '@')

/** Builds the URI another app can import. Defaults are written out so no app has to guess. */
export function buildOtpauth(account: Account): string {
  const { type, issuer, name } = account
  const prefixed = issuer && !name.startsWith(`${issuer}:`)
  const label = prefixed ? `${encodeLabelPart(issuer)}:${encodeLabelPart(name)}` : encodeLabelPart(name)
  const params = [`secret=${encodeBase32(account.secret)}`]
  if (issuer) params.push(`issuer=${encodeURIComponent(issuer)}`)
  params.push(`algorithm=${account.algorithm}`, `digits=${account.digits}`)
  params.push(type === 'totp' ? `period=${account.period}` : `counter=${account.counter}`)
  return `otpauth://${type}/${label}?${params.join('&')}`
}

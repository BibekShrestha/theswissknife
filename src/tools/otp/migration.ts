import type { Account } from './uri'
import type { Algorithm, OtpType } from './otp'

/**
 * Google Authenticator's "Transfer accounts" export:
 *   otpauth-migration://offline?data=<base64 MigrationPayload protobuf>
 *
 * The schema is not published; this is the one the export tools in the wild
 * agree on (field numbers and enum values):
 *
 *   message MigrationPayload {
 *     repeated OtpParameters otp_parameters = 1;
 *     int32 version = 2; int32 batch_size = 3; int32 batch_index = 4; int32 batch_id = 5;
 *   }
 *   message OtpParameters {
 *     bytes secret = 1; string name = 2; string issuer = 3;
 *     Algorithm algorithm = 4;  // 0 unspecified, 1 SHA1, 2 SHA256, 3 SHA512, 4 MD5
 *     DigitCount digits = 5;    // 0 unspecified, 1 six, 2 eight
 *     OtpType type = 6;         // 0 unspecified, 1 HOTP, 2 TOTP
 *     int64 counter = 7;
 *   }
 *
 * A large export is split across several QR codes: each carries its own
 * accounts plus batch_index (0-based) of batch_size, all sharing batch_id.
 * There is no period field — the exported TOTP accounts are 30-second ones.
 */

export const MIGRATION_PERIOD = 30

export interface MigrationAccount {
  name: string
  issuer: string
  secret: Uint8Array
  /** Raw enum values, so the UI can show exactly what the payload said. */
  algorithmValue: number
  digitsValue: number
  typeValue: number
  counter: bigint
  /** What the enums mean, with a defaulted value spelled out. */
  algorithm: string
  digits: string
  type: string
  /** Defaults applied to unset fields. */
  notes: string[]
  /** Set when no codes can be made; `account` is then absent. */
  problem?: string
  account?: Account
}

export interface MigrationPayload {
  accounts: MigrationAccount[]
  version: number
  batchSize: number
  batchIndex: number
  batchId: number
}

export type MigrationResult = MigrationPayload | { error: string }

class ProtoError extends Error {}

const WIRE_NAMES = ['varint', '64-bit', 'length-delimited', 'start-group', 'end-group', '32-bit']

/** A protobuf wire-format reader: just the four wire types proto3 still writes. */
export class Reader {
  pos = 0
  /** Where the current field's tag began, for error messages. */
  private fieldStart = 0
  constructor(private readonly buf: Uint8Array, private readonly where = 'payload') {}

  get done() { return this.pos >= this.buf.length }

  varint(): bigint {
    const start = this.pos
    let value = 0n
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.buf.length) throw new ProtoError(`Truncated varint at byte ${start} of the ${this.where}`)
      const byte = this.buf[this.pos++]
      if (i === 9 && byte & 0x80) throw new ProtoError(`Varint at byte ${start} of the ${this.where} is longer than 10 bytes`)
      if (i === 9 && byte > 1) throw new ProtoError(`Varint at byte ${start} of the ${this.where} overflows 64 bits`)
      value |= BigInt(byte & 0x7f) << BigInt(7 * i)
      if (!(byte & 0x80)) return value
    }
    throw new Error('unreachable')
  }

  bytes(): Uint8Array {
    const length = this.varint()
    if (length > BigInt(this.buf.length - this.pos)) {
      throw new ProtoError(`Field at byte ${this.fieldStart} of the ${this.where} claims ${length} bytes but only ${this.buf.length - this.pos} remain — the data is truncated`)
    }
    const out = this.buf.subarray(this.pos, this.pos + Number(length))
    this.pos += Number(length)
    return out
  }

  /** Field number and wire type of the next field. */
  tag(): { field: number; wire: number } {
    const start = (this.fieldStart = this.pos)
    const tag = this.varint()
    const field = Number(tag >> 3n)
    const wire = Number(tag & 7n)
    if (field === 0) throw new ProtoError(`Field number 0 at byte ${start} of the ${this.where} — this is not protobuf data`)
    if (wire > 5) throw new ProtoError(`Invalid wire type ${wire} at byte ${start} of the ${this.where}`)
    if (wire === 3 || wire === 4) throw new ProtoError(`Groups (wire type ${wire}) at byte ${start} of the ${this.where} are not part of this format`)
    return { field, wire }
  }

  skip(wire: number) {
    if (wire === 0) this.varint()
    else if (wire === 2) this.bytes()
    else {
      const size = wire === 1 ? 8 : 4
      if (this.pos + size > this.buf.length) throw new ProtoError(`Truncated ${WIRE_NAMES[wire]} field at byte ${this.fieldStart} of the ${this.where}`)
      this.pos += size
    }
  }

  expect(field: number, wire: number, want: number) {
    if (wire !== want) throw new ProtoError(`Field ${field} of the ${this.where} is ${WIRE_NAMES[wire]}, expected ${WIRE_NAMES[want]}`)
  }
}

const int32 = (v: bigint) => Number(BigInt.asIntN(32, v))
const utf8 = new TextDecoder()

const ALGORITHMS: Record<number, Algorithm | 'MD5'> = { 1: 'SHA1', 2: 'SHA256', 3: 'SHA512', 4: 'MD5' }
const DIGITS: Record<number, number> = { 1: 6, 2: 8 }
const TYPES: Record<number, OtpType> = { 1: 'hotp', 2: 'totp' }

function readAccount(bytes: Uint8Array, index: number): MigrationAccount {
  const r = new Reader(bytes, `account ${index + 1}`)
  let secret = new Uint8Array(0)
  let name = ''
  let issuer = ''
  let algorithmValue = 0
  let digitsValue = 0
  let typeValue = 0
  let counter = 0n
  while (!r.done) {
    const { field, wire } = r.tag()
    switch (field) {
      case 1: r.expect(field, wire, 2); secret = r.bytes().slice(); break
      case 2: r.expect(field, wire, 2); name = utf8.decode(r.bytes()); break
      case 3: r.expect(field, wire, 2); issuer = utf8.decode(r.bytes()); break
      case 4: r.expect(field, wire, 0); algorithmValue = int32(r.varint()); break
      case 5: r.expect(field, wire, 0); digitsValue = int32(r.varint()); break
      case 6: r.expect(field, wire, 0); typeValue = int32(r.varint()); break
      case 7: r.expect(field, wire, 0); counter = BigInt.asUintN(64, r.varint()); break
      default: r.skip(wire)
    }
  }

  const notes: string[] = []
  const problems: string[] = []

  let algorithm: Algorithm | 'MD5' | undefined = ALGORITHMS[algorithmValue]
  let algorithmLabel: string = algorithm ?? `unknown (${algorithmValue})`
  if (algorithmValue === 0) {
    algorithm = 'SHA1'
    algorithmLabel = 'SHA1 (unset)'
    notes.push('Algorithm not set — SHA1 assumed')
  } else if (algorithm === 'MD5') {
    problems.push('MD5 — browsers’ WebCrypto has no HMAC-MD5 and otpauth URIs have no MD5, so no codes or URI')
  } else if (!algorithm) {
    problems.push(`Unknown algorithm value ${algorithmValue}`)
  }

  let digits: number | undefined = DIGITS[digitsValue]
  let digitsLabel = digits ? String(digits) : `unknown (${digitsValue})`
  if (digitsValue === 0) {
    digits = 6
    digitsLabel = '6 (unset)'
    notes.push('Digit count not set — 6 assumed')
  } else if (!digits) {
    problems.push(`Unknown digit-count value ${digitsValue}`)
  }

  let type: OtpType | undefined = TYPES[typeValue]
  let typeLabel = type ? type.toUpperCase() : `unknown (${typeValue})`
  if (typeValue === 0) {
    type = 'totp'
    typeLabel = 'TOTP (unset)'
    notes.push('Type not set — TOTP assumed')
  } else if (!type) {
    problems.push(`Unknown OTP type value ${typeValue}`)
  }

  if (!secret.length) problems.push('No secret')

  const out: MigrationAccount = {
    name, issuer, secret, algorithmValue, digitsValue, typeValue, counter,
    algorithm: algorithmLabel, digits: digitsLabel, type: typeLabel, notes,
  }
  if (problems.length) out.problem = problems.join('; ')
  else out.account = { type: type!, secret, name, issuer, algorithm: algorithm as Algorithm, digits: digits!, period: MIGRATION_PERIOD, counter }
  return out
}

export function decodeMigrationPayload(bytes: Uint8Array): MigrationResult {
  try {
    const r = new Reader(bytes)
    const payload: MigrationPayload = { accounts: [], version: 0, batchSize: 0, batchIndex: 0, batchId: 0 }
    while (!r.done) {
      const { field, wire } = r.tag()
      switch (field) {
        case 1: r.expect(field, wire, 2); payload.accounts.push(readAccount(r.bytes(), payload.accounts.length)); break
        case 2: r.expect(field, wire, 0); payload.version = int32(r.varint()); break
        case 3: r.expect(field, wire, 0); payload.batchSize = int32(r.varint()); break
        case 4: r.expect(field, wire, 0); payload.batchIndex = int32(r.varint()); break
        case 5: r.expect(field, wire, 0); payload.batchId = int32(r.varint()); break
        default: r.skip(wire)
      }
    }
    return payload
  } catch (e) {
    if (e instanceof ProtoError) return { error: e.message }
    throw e
  }
}

/** Standard or URL-safe Base64, padded or not; spaces are `+` that a form decoder mangled. */
function decodeBase64(text: string): Uint8Array | null {
  const std = text.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  if (!/^[A-Za-z0-9+/]*$/.test(std) || std.length % 4 === 1) return null
  const binary = atob(std + '='.repeat((4 - (std.length % 4)) % 4))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

export function parseMigrationUri(input: string): MigrationResult {
  const text = input.trim()
  const m = /^otpauth-migration:\/\/([^/?#]*)\/?(?:\?([^#]*))?/i.exec(text)
  if (!m) return { error: 'Not an otpauth-migration:// URI' }
  if (m[1].toLowerCase() !== 'offline') return { error: `Expected otpauth-migration://offline?data=… — got “${m[1] || '(nothing)'}” after //` }
  const raw = (m[2] ?? '').split('&').find((part) => /^data=/i.test(part))?.slice(5)
  if (raw === undefined) return { error: 'The migration URI has no data parameter' }
  let data: string
  try {
    data = decodeURIComponent(raw)
  } catch {
    return { error: 'The data parameter has a broken %-escape' }
  }
  if (!data) return { error: 'The data parameter is empty' }
  const bytes = decodeBase64(data)
  if (!bytes) return { error: 'The data parameter is not valid Base64' }
  return decodeMigrationPayload(bytes)
}

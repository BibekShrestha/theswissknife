import { decodeBase32 } from './base32'
import { parseMigrationUri, type MigrationPayload } from './migration'
import { parseOtpauth, type Account } from './uri'

/**
 * Everything the tool was given — the text field and each scanned QR code —
 * read into sources. A field that mentions otpauth is a list of URIs split
 * on whitespace (URIs never contain any); anything else is one Base32 secret,
 * whose groups of four may be separated by spaces.
 */

export type Source = (
  | { kind: 'secret'; origin: string; secret: Uint8Array; normalized: string }
  | { kind: 'otpauth'; origin: string; account: Account; warnings: string[] }
  | { kind: 'migration'; origin: string; payload: MigrationPayload }
  | { kind: 'invalid'; origin: string; error: string }
) & {
  /** Which input it came from (the text field, one scanned image's code), so entry ids survive edits elsewhere. */
  group?: string
}

export function parseToken(token: string, origin: string): Source {
  if (/^otpauth-migration:/i.test(token)) {
    const payload = parseMigrationUri(token)
    return 'error' in payload ? { kind: 'invalid', origin, error: payload.error } : { kind: 'migration', origin, payload }
  }
  const uri = parseOtpauth(token)
  return 'error' in uri ? { kind: 'invalid', origin, error: uri.error } : { kind: 'otpauth', origin, ...uri }
}

export function parseField(text: string): Source[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (/otpauth/i.test(trimmed)) {
    const tokens = trimmed.split(/\s+/)
    return tokens.map((token, i) => parseToken(token, tokens.length > 1 ? `Pasted URI ${i + 1}` : 'Pasted URI'))
  }
  const secret = decodeBase32(trimmed)
  if ('error' in secret) return [{ kind: 'invalid', origin: 'Pasted secret', error: secret.error }]
  return [{ kind: 'secret', origin: 'Pasted secret', secret: secret.bytes, normalized: secret.normalized }]
}

/** A scanned QR code: only otpauth payloads mean anything here. */
export function parseScanned(text: string, origin: string): Source {
  const trimmed = text.trim()
  if (!/^otpauth(-migration)?:/i.test(trimmed)) {
    return { kind: 'invalid', origin, error: 'This QR code is not an otpauth:// or otpauth-migration:// link' }
  }
  return parseToken(trimmed, origin)
}

export interface BatchStatus {
  batchId: number
  size: number
  /** 1-based QR numbers loaded / not loaded. */
  loaded: number[]
  missing: number[]
  /** 1-based numbers seen more than once. */
  repeated: number[]
  /** Indices that cannot belong to a batch this size. */
  outOfRange: number[]
}

/** Groups multi-QR exports by batch id and says which parts are still missing. */
export function batchStatus(payloads: MigrationPayload[]): BatchStatus[] {
  const groups = new Map<number, MigrationPayload[]>()
  for (const p of payloads) {
    if (p.batchSize <= 1) continue
    groups.set(p.batchId, [...(groups.get(p.batchId) ?? []), p])
  }
  return [...groups].map(([batchId, parts]) => {
    const size = Math.max(...parts.map((p) => p.batchSize))
    const counts = new Map<number, number>()
    for (const p of parts) counts.set(p.batchIndex, (counts.get(p.batchIndex) ?? 0) + 1)
    const all = Array.from({ length: size }, (_, i) => i)
    return {
      batchId,
      size,
      loaded: all.filter((i) => counts.has(i)).map((i) => i + 1),
      missing: all.filter((i) => !counts.has(i)).map((i) => i + 1),
      repeated: [...counts].filter(([i, n]) => n > 1 && i >= 0 && i < size).map(([i]) => i + 1).sort((a, b) => a - b),
      outOfRange: [...counts.keys()].filter((i) => i < 0 || i >= size).sort((a, b) => a - b),
    }
  })
}

/**
 * Share a redaction scheme: the mask, the space setting and the patterns —
 * never the text being redacted.
 *
 * Two rules decide the shape of this file:
 *
 * 1. **A literal target is the secret.** Selecting an address and redacting it
 *    stores that address as a target, so a link carrying literals publishes
 *    exactly what the tool was used to hide. Literals are left out unless the
 *    sharer opts in and is told what becomes readable.
 * 2. **It travels in the fragment**, like /jq's share links. Fragments are
 *    never sent anywhere — not to Pages, not to the proxy in front of it, not
 *    in a Referer header — which is the only transport that keeps the site's
 *    promise that nothing you paste leaves your machine.
 */

import { DEFAULT_OPTIONS, normalizeMask, type SpaceMode, type Target } from './redact'

export type Scope = 'all' | 'picked'

export interface Scheme {
  mask: string
  spaces: SpaceMode
  scope: Scope
  caseSensitive: boolean
  targets: Target[]
}

/** Bumped when the payload shape changes; older links are then ignored. */
export const VERSION = 1

/** Limits applied to anything arriving from a link. */
export const MAX_TARGETS = 200
export const MAX_PATTERN = 500

/**
 * A link past this stops being practical: Outlook wraps around a thousand
 * characters, ticket fields and CRMs truncate near 2k, and QR codes get dense.
 */
export const LENGTH_WARN = 1_500
export const LENGTH_MAX = 8_000

const SPACE_MODES: SpaceMode[] = ['keep', 'remove', 'redact']

/** Compact on purpose: short keys keep the JSON export readable and small. */
interface Wire {
  v: number
  m: string
  s: SpaceMode
  k: Scope
  c?: 1
  t: [string, string][]
}

export function toWire(scheme: Scheme, includeLiterals: boolean): Wire {
  const targets = includeLiterals
    ? scheme.targets
    : scheme.targets.filter((target) => target.kind === 'regex')
  const wire: Wire = {
    v: VERSION,
    m: scheme.mask,
    s: scheme.spaces,
    k: scheme.scope,
    t: targets.map((target) => [target.kind === 'regex' ? 'r' : 'l', target.value]),
  }
  if (scheme.caseSensitive) wire.c = 1
  return wire
}

/** Rebuilds a scheme from anything at all, or gives up. */
export function normalizeScheme(raw: unknown): Scheme | null {
  if (!raw || typeof raw !== 'object') return null
  const wire = raw as Partial<Wire>
  if (wire.v !== VERSION) return null

  const targets: Target[] = []
  if (Array.isArray(wire.t)) {
    for (const entry of wire.t.slice(0, MAX_TARGETS)) {
      if (!Array.isArray(entry) || entry.length < 2) continue
      const [kind, value] = entry
      if (typeof value !== 'string' || !value || value.length > MAX_PATTERN) continue
      targets.push({ kind: kind === 'r' ? 'regex' : 'literal', value })
    }
  }

  return {
    mask: normalizeMask(typeof wire.m === 'string' ? wire.m : ''),
    spaces: SPACE_MODES.includes(wire.s as SpaceMode)
      ? (wire.s as SpaceMode)
      : DEFAULT_OPTIONS.spaces,
    scope: wire.k === 'picked' ? 'picked' : 'all',
    caseSensitive: wire.c === 1,
    targets,
  }
}

/** The `#p=` payload for a scheme. */
export async function encodeScheme(scheme: Scheme, includeLiterals: boolean): Promise<string> {
  return b64url(await deflate(JSON.stringify(toWire(scheme, includeLiterals))))
}

export async function decodeFragment(hash: string): Promise<Scheme | null> {
  const match = /^#p=([^&]+)$/.exec(hash)
  if (!match) return null
  try {
    return normalizeScheme(JSON.parse(await inflate(bytesFromB64url(match[1]))))
  } catch {
    return null // truncated by a chat client, hand-edited, or from a future version
  }
}

export function schemeUrl(payload: string, base: string): string {
  return `${base}#p=${payload}`
}

/** The same payload, uncompressed, for keeping a profile in a repo. */
export function schemeJson(scheme: Scheme, includeLiterals: boolean): string {
  return JSON.stringify(toWire(scheme, includeLiterals), null, 2)
}

export function schemeFromJson(text: string): Scheme | null {
  try {
    return normalizeScheme(JSON.parse(text))
  } catch {
    return null
  }
}

export function countKinds(targets: Target[]): { patterns: number; literals: number } {
  let patterns = 0
  let literals = 0
  for (const target of targets) {
    if (target.kind === 'regex') patterns++
    else literals++
  }
  return { patterns, literals }
}

/**
 * deflate-raw rather than gzip: same browser support, ~20 bytes smaller, and it
 * beats plain base64 even on the tiniest payload.
 */
async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function inflate(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  return new Response(stream).text()
}

function b64url(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function bytesFromB64url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

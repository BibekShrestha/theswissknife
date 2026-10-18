/**
 * Share links: `#r=<base64url(deflate-raw(json))>` in the URL fragment, the
 * same transport as /redact's `#p=` and /jq's `#z=` (copied, not imported —
 * tools stay self-contained). Fragments are never sent to a server, not even
 * in a Referer header, so the site's "nothing leaves your machine" promise
 * holds for whatever the link carries.
 *
 * The pattern, flags, operation and replacement always travel. The subject
 * and the test cases travel only when the sharer ticks the box for each: they
 * are often real data (log lines, addresses) pasted to try the pattern on.
 *
 * Anything arriving from a link is normalised: oversized fields are dropped,
 * flags are filtered to the ones the lab offers, and the shape is rebuilt
 * from scratch rather than trusted.
 */

import type { RegexOperation, TestCase } from './types'

export interface LabState {
  pattern: string
  flags: string
  operation: RegexOperation
  replacement: string
  subject?: string
  cases?: TestCase[]
}

/** Bumped when the payload shape changes; older links are then ignored. */
export const VERSION = 1

export const MAX_PATTERN = 10_000
export const MAX_REPLACEMENT = 10_000
export const MAX_SUBJECT = 200_000
export const MAX_CASES = 200
export const MAX_CASE_LENGTH = 2_000

/** Past these the link stops being practical; the dialog says so. */
export const LENGTH_WARN = 2_000
export const LENGTH_MAX = 64_000
/** What decoding accepts at all — more than any link this tool writes. */
export const MAX_FRAGMENT = 1_000_000

/** The flags the lab offers, in the order RegExp.prototype.flags prints them. */
export const FLAG_ORDER = 'dgimsuvy'

interface Wire {
  v: number
  p: string
  f: string
  o?: 'r'
  r?: string
  s?: string
  /** [text, 1 = should match / 0 = should not, 1 = full match]. */
  t?: [string, 0 | 1, 0 | 1][]
}

export interface ShareOptions {
  subject: boolean
  cases: boolean
}

export function toWire(state: LabState, include: ShareOptions): Wire {
  const wire: Wire = { v: VERSION, p: state.pattern, f: state.flags }
  if (state.operation === 'replace') wire.o = 'r'
  if (state.replacement) wire.r = state.replacement
  if (include.subject && state.subject) wire.s = state.subject
  if (include.cases && state.cases?.length) {
    wire.t = state.cases.map((c) => [c.text, c.expect === 'match' ? 1 : 0, c.full ? 1 : 0])
  }
  return wire
}

/** Only the lab's flags, each once, canonical order; u wins over v (they exclude each other). */
export function normalizeFlags(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const set = new Set(raw.slice(0, 32))
  if (set.has('u')) set.delete('v')
  return [...FLAG_ORDER].filter((flag) => set.has(flag)).join('')
}

/** Rebuilds a state from anything at all, or gives up. */
export function normalizeState(raw: unknown): LabState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const wire = raw as Partial<Wire>
  if (wire.v !== VERSION) return null
  if (typeof wire.p !== 'string' || wire.p.length > MAX_PATTERN) return null

  const state: LabState = {
    pattern: wire.p,
    flags: normalizeFlags(wire.f),
    operation: wire.o === 'r' ? 'replace' : 'match',
    replacement: typeof wire.r === 'string' && wire.r.length <= MAX_REPLACEMENT ? wire.r : '',
  }
  if (typeof wire.s === 'string' && wire.s.length <= MAX_SUBJECT) state.subject = wire.s
  if (Array.isArray(wire.t)) {
    const cases: TestCase[] = []
    for (const entry of wire.t.slice(0, MAX_CASES)) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || entry[0].length > MAX_CASE_LENGTH) continue
      // A case is one line; a hand-made link could smuggle in more.
      const text = entry[0].split(/\r?\n/, 1)[0]
      cases.push({ text, expect: entry[1] === 0 ? 'no-match' : 'match', full: entry[2] === 1 })
    }
    if (cases.length) state.cases = cases
  }
  return state
}

/** The `#r=` payload. */
export async function encodeState(state: LabState, include: ShareOptions): Promise<string> {
  return b64url(await deflate(JSON.stringify(toWire(state, include))))
}

export async function decodeFragment(hash: string): Promise<LabState | null> {
  const match = /^#r=([A-Za-z0-9_-]+)$/.exec(hash)
  if (!match || match[1].length > MAX_FRAGMENT) return null
  try {
    return normalizeState(JSON.parse(await inflate(bytesFromB64url(match[1]))))
  } catch {
    return null // truncated by a chat client, hand-edited, or from a future version
  }
}

export function shareUrl(payload: string, base: string): string {
  return `${base}#r=${payload}`
}

/**
 * deflate-raw rather than gzip: same browser support, ~20 bytes smaller.
 * JSON.stringify escapes lone surrogates (\ud83d), so a subject holding half
 * an emoji survives the UTF-8 step intact.
 */
async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Inflated payloads are capped: a few KB of link can expand to gigabytes. */
const MAX_INFLATED = 4_000_000

async function inflate(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > MAX_INFLATED) {
      await reader.cancel()
      throw new Error('payload too large')
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(await new Blob(chunks as BlobPart[]).arrayBuffer())
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

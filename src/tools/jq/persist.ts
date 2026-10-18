import { defaultOptions, type Indent, type JqOptions, type NamedArg, type OutputMode, type PositionalArg } from './types'
import { DEFAULT_EXAMPLE } from './examples'

export interface AppState {
  filter: string
  input: string
  options: JqOptions
  autoRun: boolean
}

const STORAGE_KEY = 'jqplay.state.v1'

function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function bytesFromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

/** The values the settings panel offers; anything else came from a hand-edited link. */
export const TIMEOUT_CHOICES: readonly number[] = [5, 15, 60]
const OUTPUT_MODES: readonly OutputMode[] = ['json', 'raw', 'join']
const INDENTS: readonly Indent[] = [2, 4, 8, 'tab']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function namedArgs(value: unknown): NamedArg[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((a): NamedArg[] =>
    isRecord(a) && (a.kind === 'arg' || a.kind === 'argjson') && typeof a.name === 'string' && typeof a.value === 'string'
      ? [{ kind: a.kind, name: a.name, value: a.value }]
      : [],
  )
}

function positionalArgs(value: unknown): PositionalArg[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((a): PositionalArg[] =>
    isRecord(a) && (a.kind === 'string' || a.kind === 'json') && typeof a.value === 'string'
      ? [{ kind: a.kind, value: a.value }]
      : [],
  )
}

/**
 * Options from a share link or localStorage, field by field: only known keys,
 * each checked against its default's type and the values the UI offers. A
 * link is someone else's JSON — `namedArgs: null` would crash every render
 * and `timeoutSec: 0` would kill every run while the select still said 15 s.
 */
export function sanitizeOptions(raw: unknown): JqOptions {
  const o = isRecord(raw) ? raw : {}
  const bool = (key: keyof JqOptions) => (typeof o[key] === 'boolean' ? (o[key] as boolean) : (defaultOptions[key] as boolean))
  return {
    nullInput: bool('nullInput'),
    rawInput: bool('rawInput'),
    slurp: bool('slurp'),
    seq: bool('seq'),
    stream: bool('stream'),
    outputMode: OUTPUT_MODES.includes(o.outputMode as OutputMode) ? (o.outputMode as OutputMode) : defaultOptions.outputMode,
    compact: bool('compact'),
    indent: INDENTS.includes(o.indent as Indent) ? (o.indent as Indent) : defaultOptions.indent,
    sortKeys: bool('sortKeys'),
    asciiOutput: bool('asciiOutput'),
    exitStatus: bool('exitStatus'),
    timeoutSec: TIMEOUT_CHOICES.includes(o.timeoutSec as number) ? (o.timeoutSec as number) : defaultOptions.timeoutSec,
    namedArgs: namedArgs(o.namedArgs),
    positionalArgs: positionalArgs(o.positionalArgs),
    extraFlags: typeof o.extraFlags === 'string' ? o.extraFlags : defaultOptions.extraFlags,
  }
}

export function normalize(raw: Partial<AppState> | null | undefined): AppState | null {
  if (!isRecord(raw) || typeof raw.filter !== 'string' || typeof raw.input !== 'string') return null
  return {
    filter: raw.filter,
    input: raw.input,
    options: sanitizeOptions(raw.options),
    autoRun: raw.autoRun !== false,
  }
}

/** Gzipped base64url payload for a share link (the part after `#z=`). */
export async function encodeSharePayload(state: AppState): Promise<string> {
  return b64urlFromBytes(await gzip(JSON.stringify(state)))
}

/** Decode a share fragment: `#z=` (gzipped, current) or `#s=` (legacy plain). */
export async function decodeShareHash(hash: string): Promise<AppState | null> {
  try {
    const z = hash.match(/^#z=(.+)$/)
    if (z) return normalize(JSON.parse(await gunzip(bytesFromB64url(z[1]))))
    const s = hash.match(/^#s=(.+)$/)
    if (s) return normalize(JSON.parse(new TextDecoder().decode(bytesFromB64url(s[1]))))
  } catch {
    // malformed/corrupt fragment
  }
  return null
}

export async function encodeShareUrl(state: AppState): Promise<string> {
  return `${location.origin}${location.pathname}#z=${await encodeSharePayload(state)}`
}

export function loadInitialState(): AppState {
  // previous session (share links are decoded async in App)
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const st = normalize(JSON.parse(stored))
      if (st) return st
    }
  } catch {
    // fall through
  }
  return {
    filter: DEFAULT_EXAMPLE.filter,
    input: DEFAULT_EXAMPLE.input,
    options: { ...defaultOptions, ...(DEFAULT_EXAMPLE.options ?? {}) },
    autoRun: true,
  }
}

export function saveState(state: AppState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // storage full or unavailable — not fatal
  }
}

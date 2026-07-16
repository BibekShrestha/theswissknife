import { defaultOptions, type JqOptions } from './types'
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

export function normalize(raw: Partial<AppState> | null | undefined): AppState | null {
  if (!raw || typeof raw.filter !== 'string' || typeof raw.input !== 'string') return null
  return {
    filter: raw.filter,
    input: raw.input,
    options: { ...defaultOptions, ...(raw.options ?? {}) },
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

import { defaultOptions, type JqOptions } from './types'
import { DEFAULT_EXAMPLE } from './examples'

export interface AppState {
  filter: string
  input: string
  options: JqOptions
  autoRun: boolean
}

const STORAGE_KEY = 'jqplay.state.v1'

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

function normalize(raw: Partial<AppState> | null | undefined): AppState | null {
  if (!raw || typeof raw.filter !== 'string' || typeof raw.input !== 'string') return null
  return {
    filter: raw.filter,
    input: raw.input,
    options: { ...defaultOptions, ...(raw.options ?? {}) },
    autoRun: raw.autoRun !== false,
  }
}

export function encodeShareUrl(state: AppState): string {
  const payload = b64urlEncode(JSON.stringify(state))
  return `${location.origin}${location.pathname}#s=${payload}`
}

export function loadInitialState(): AppState {
  // 1. shared link
  const m = location.hash.match(/^#s=(.+)$/)
  if (m) {
    try {
      const st = normalize(JSON.parse(b64urlDecode(m[1])))
      if (st) return st
    } catch {
      // fall through
    }
  }
  // 2. previous session
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const st = normalize(JSON.parse(stored))
      if (st) return st
    }
  } catch {
    // fall through
  }
  // 3. default example
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

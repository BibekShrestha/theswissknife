import type { MigrationAccount } from './migration'
import type { Algorithm, OtpType } from './otp'
import type { Source } from './sources'
import type { Account } from './uri'

/** What the settings bar sets for a bare Base32 secret, which carries no parameters. */
export interface ManualSettings {
  type: OtpType
  algorithm: Algorithm
  digits: number
  period: number
}

export const DEFAULT_SETTINGS: ManualSettings = { type: 'totp', algorithm: 'SHA1', digits: 6, period: 30 }

/** One account the tool can show, from whichever source it came. */
export interface Entry {
  id: string
  origin: string
  /** Issuer and name as the source gave them; empty for a bare secret. */
  issuer: string
  name: string
  /** Absent when the account cannot make codes (see `problem`). */
  account?: Account
  problem?: string
  /** Warnings, assumed defaults, weak-secret notes. */
  notes: string[]
  manual: boolean
  /** The raw export record, for showing what the payload said. */
  migration?: MigrationAccount
}

/** RFC 4226 §4 R6: at least 128 bits, 160 recommended. */
export function secretNotes(secret: Uint8Array): string[] {
  return secret.length < 16 ? [`The secret is ${secret.length * 8} bits — RFC 4226 asks for at least 128 (160 recommended)`] : []
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/** cyrb53: a fast 53-bit string hash. Ids only need to tell accounts apart, and must not spell out a secret. */
function hash(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

const accountKey = (a: Account) => [a.type, a.algorithm, a.digits, a.period, a.counter, hex(a.secret), a.issuer, a.name].join('\u0000')

/**
 * Entry ids come from what an entry is — its input group plus its secret
 * and parameters — not from its position, so removing one URI does not
 * hand its counter edits or selection to the next. Repeats of the same
 * account in one group are told apart by occurrence.
 */
export function toEntries(sources: Source[], settings: ManualSettings): { entries: Entry[]; errors: { origin: string; error: string }[] } {
  const entries: Entry[] = []
  const errors: { origin: string; error: string }[] = []
  const seen = new Map<string, number>()
  const idFor = (source: Source, content: string) => {
    const key = `${source.group ?? ''}\u0001${content}`
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    return `${hash(key)}${n > 1 ? `-${n}` : ''}`
  }
  sources.forEach((source) => {
    switch (source.kind) {
      case 'invalid':
        errors.push({ origin: source.origin, error: source.error })
        break
      case 'secret':
        entries.push({
          id: idFor(source, `secret\u0000${hex(source.secret)}`), origin: source.origin, issuer: '', name: '', manual: true, notes: secretNotes(source.secret),
          account: { ...settings, secret: source.secret, name: '', issuer: '', counter: 0n },
        })
        break
      case 'otpauth':
        entries.push({
          id: idFor(source, `otpauth\u0000${accountKey(source.account)}`), origin: source.origin, issuer: source.account.issuer, name: source.account.name, manual: false,
          account: source.account, notes: [...source.warnings, ...secretNotes(source.account.secret)],
        })
        break
      case 'migration':
        source.payload.accounts.forEach((m) => {
          const content = [m.typeValue, m.algorithmValue, m.digitsValue, m.counter, hex(m.secret), m.issuer, m.name].join('\u0000')
          entries.push({
            id: idFor(source, `migration\u0000${content}`), origin: source.origin, issuer: m.issuer, name: m.name, manual: false, migration: m,
            account: m.account, problem: m.problem, notes: [...m.notes, ...(m.account ? secretNotes(m.secret) : [])],
          })
        })
        if (!source.payload.accounts.length) errors.push({ origin: source.origin, error: 'This export holds no accounts' })
        break
    }
  })
  return { entries, errors }
}

/** Per-entry state (counter edits) without the entries that are gone; the same object when nothing went. */
export function pruneState<T>(state: Record<string, T>, entries: Entry[]): Record<string, T> {
  const live = new Set(entries.map((entry) => entry.id))
  const keys = Object.keys(state)
  if (keys.every((key) => live.has(key))) return state
  return Object.fromEntries(keys.filter((key) => live.has(key)).map((key) => [key, state[key]]))
}

export function entryTitle(entry: Entry): string {
  if (entry.manual) return 'Pasted secret'
  const { issuer, name } = entry
  const bare = issuer && name.startsWith(`${issuer}:`) ? name.slice(issuer.length + 1).trim() : name
  return [issuer, bare].filter(Boolean).join(' · ') || '(no name)'
}

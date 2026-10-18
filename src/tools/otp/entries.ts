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

export function toEntries(sources: Source[], settings: ManualSettings): { entries: Entry[]; errors: { origin: string; error: string }[] } {
  const entries: Entry[] = []
  const errors: { origin: string; error: string }[] = []
  sources.forEach((source, si) => {
    switch (source.kind) {
      case 'invalid':
        errors.push({ origin: source.origin, error: source.error })
        break
      case 'secret':
        entries.push({
          id: `${si}`, origin: source.origin, issuer: '', name: '', manual: true, notes: secretNotes(source.secret),
          account: { ...settings, secret: source.secret, name: '', issuer: '', counter: 0n },
        })
        break
      case 'otpauth':
        entries.push({
          id: `${si}`, origin: source.origin, issuer: source.account.issuer, name: source.account.name, manual: false,
          account: source.account, notes: [...source.warnings, ...secretNotes(source.account.secret)],
        })
        break
      case 'migration':
        source.payload.accounts.forEach((m, ai) => {
          entries.push({
            id: `${si}.${ai}`, origin: source.origin, issuer: m.issuer, name: m.name, manual: false, migration: m,
            account: m.account, problem: m.problem, notes: [...m.notes, ...(m.account ? secretNotes(m.secret) : [])],
          })
        })
        if (!source.payload.accounts.length) errors.push({ origin: source.origin, error: 'This export holds no accounts' })
        break
    }
  })
  return { entries, errors }
}

export function entryTitle(entry: Entry): string {
  if (entry.manual) return 'Pasted secret'
  const { issuer, name } = entry
  const bare = issuer && name.startsWith(`${issuer}:`) ? name.slice(issuer.length + 1).trim() : name
  return [issuer, bare].filter(Boolean).join(' · ') || '(no name)'
}

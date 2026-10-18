import { useEffect, useState } from 'react'
import { hotp, importSecret } from './otp'
import type { Account } from './uri'

/** Unix time in (fractional) seconds, refreshed a few times a second for the countdown. */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

/** The account's HMAC key, imported once per account (WebCrypto keys are not extractable here). */
export function useKey(account: Account | undefined): CryptoKey | null {
  const [state, setState] = useState<{ account: Account; key: CryptoKey } | null>(null)
  useEffect(() => {
    if (!account) return
    let live = true
    importSecret(account.secret, account.algorithm).then((key) => { if (live) setState({ account, key }) }, () => {})
    return () => { live = false }
  }, [account])
  return state && state.account === account ? state.key : null
}

/** Codes for each counter, keyed by the counter's decimal string. */
export function useCodes(key: CryptoKey | null, digits: number, counters: bigint[]): Record<string, string> {
  const signature = counters.join(',')
  const [state, setState] = useState<{ key: CryptoKey; digits: number; codes: Record<string, string> } | null>(null)
  useEffect(() => {
    if (!key) return
    let live = true
    const list = signature ? signature.split(',').map(BigInt) : []
    Promise.all(list.map((c) => hotp(key, c, digits))).then((codes) => {
      if (live) setState({ key, digits, codes: Object.fromEntries(list.map((c, i) => [String(c), codes[i]])) })
    }, () => {})
    return () => { live = false }
  }, [key, digits, signature])
  return state && state.key === key && state.digits === digits ? state.codes : {}
}

/** 123 456, 123 4567, 1234 5678 — how authenticator apps group codes. */
export function groupCode(code: string): string {
  const cut = code.length === 8 ? 4 : 3
  return `${code.slice(0, cut)} ${code.slice(cut)}`
}

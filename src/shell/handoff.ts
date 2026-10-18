import { navigate } from './router'

/**
 * Passes data from one tool to another ("Query with SQL" in the CSV viewer
 * opens the file in the SQLite viewer). One payload, held in memory only —
 * never in the URL or storage, since it is the user's data — and consumed by
 * the first `takeHandoff` for its slug. A reload or a visit to any other tool
 * leaves nothing behind.
 */
export interface Handoff {
  name: string
  text?: string
  bytes?: Uint8Array
  type?: string
}

let slot: { to: string; payload: Handoff } | null = null

/** Holds `payload` for the tool at `slug` and navigates there. */
export function sendTo(slug: string, payload: Handoff): void {
  slot = { to: slug, payload }
  navigate(`/${slug}`)
}

/** Returns the payload sent to `slug` and clears it (single use), or null. */
export function takeHandoff(slug: string): Handoff | null {
  if (!slot) return null
  const { to, payload } = slot
  slot = null
  return to === slug ? payload : null
}

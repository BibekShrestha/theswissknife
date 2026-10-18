import { navigate } from './router'

/**
 * Passes data from one tool to another ("Query with SQL" in the CSV viewer
 * opens the file in the SQLite viewer). One payload, held in memory only —
 * never in the URL or storage, since it is the user's data — and consumed by
 * the first `takeHandoff` for its slug. It is also dropped when the user goes
 * anywhere other than the target (every route change reaches
 * `releaseHandoff`, see the listener below) and after HANDOFF_TTL_MS, so a target that failed to load cannot
 * pick it up on some later visit. A reload leaves nothing behind either.
 */
export interface Handoff {
  name: string
  text?: string
  bytes?: Uint8Array
  type?: string
}

/** Long enough for a slow network to fetch the target tool's chunk; short enough not to linger. */
export const HANDOFF_TTL_MS = 30_000

let slot: { to: string; payload: Handoff } | null = null
let expiry: ReturnType<typeof setTimeout> | undefined

function clear() {
  slot = null
  clearTimeout(expiry)
}

/** Holds `payload` for the tool at `slug` and navigates there. */
export function sendTo(slug: string, payload: Handoff): void {
  clear()
  slot = { to: slug, payload }
  expiry = setTimeout(clear, HANDOFF_TTL_MS)
  navigate(`/${slug}`)
}

/** Returns the payload sent to `slug` and clears it (single use), or null. */
export function takeHandoff(slug: string): Handoff | null {
  if (!slot) return null
  const { to, payload } = slot
  clear()
  return to === slug ? payload : null
}

/** Drops a pending payload unless `path` (the route now showing) is its target. */
export function releaseHandoff(path: string): void {
  if (slot && slot.to !== path) clear()
}

// The router announces every route change on window (router.ts emit). Read
// from the event rather than imported, so this module adds nothing to the
// entry chunk and still works where a test mocks the router down to navigate.
if (typeof window !== 'undefined') {
  window.addEventListener('shell:route', (event) => releaseHandoff(String((event as CustomEvent).detail)))
}

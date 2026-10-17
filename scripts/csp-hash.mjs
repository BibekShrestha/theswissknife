import { createHash } from 'node:crypto'

/**
 * index.html's CSP allows its one inline script (the pre-paint theme boot)
 * by hash. Edit that script without updating the hash and production blocks
 * it silently: every load paints unthemed until React starts. These helpers
 * let a test and the build check recompute the hash instead of trusting it.
 */

/** Bodies of the inline scripts the browser executes (JSON-LD is data, not code). */
export function inlineScripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter(([, attrs]) => !/\bsrc=/.test(attrs) && !/type=["']application\/ld\+json["']/.test(attrs))
    .map(([, , body]) => body)
}

export const sha384 = (text) => `sha384-${createHash('sha384').update(text, 'utf8').digest('base64')}`

/** Hashes listed in the CSP meta's script-src. */
export function allowedHashes(html) {
  const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html)?.[1] ?? ''
  const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src')) ?? ''
  return [...scriptSrc.matchAll(/'(sha(?:256|384|512)-[^']+)'/g)].map((m) => m[1])
}

/** Problems with the page's inline-script hashes; empty when they all match. */
export function cspProblems(html) {
  const allowed = allowedHashes(html)
  const actual = inlineScripts(html).map(sha384)
  return [
    ...actual.filter((h) => !allowed.includes(h)).map((h) => `inline script is not allowed by the CSP — script-src needs '${h}'`),
    ...allowed.filter((h) => !actual.includes(h)).map((h) => `CSP allows '${h}', which matches no inline script — remove it`),
  ]
}

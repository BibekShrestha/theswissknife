import { describe, expect, it } from 'vitest'
// @ts-expect-error — a plain .mjs helper shared with scripts/check-bundle.mjs
import { allowedHashes, cspProblems, inlineScripts, sha384 } from '../../scripts/csp-hash.mjs'

const html = Object.values(import.meta.glob<string>('/index.html', { query: '?raw', import: 'default', eager: true }))[0]

describe('index.html CSP', () => {
  it('allows exactly the inline scripts the page runs', () => {
    // Editing the theme boot script changes its hash; the CSP must follow.
    expect(cspProblems(html)).toEqual([])
    expect(inlineScripts(html)).toHaveLength(1)
  })

  it('reports a stale hash and the one to use', () => {
    const page = `<meta http-equiv="Content-Security-Policy" content="script-src 'self' 'sha384-old'" /><script>boot()</script>`
    expect(allowedHashes(page)).toEqual(['sha384-old'])
    expect(cspProblems(page)).toEqual([
      `inline script is not allowed by the CSP — script-src needs '${sha384('boot()')}'`,
      "CSP allows 'sha384-old', which matches no inline script — remove it",
    ])
  })

  it('ignores JSON-LD and external scripts', () => {
    expect(inlineScripts('<script type="application/ld+json">{}</script><script type="module" src="/a.js"></script>')).toEqual([])
  })
})

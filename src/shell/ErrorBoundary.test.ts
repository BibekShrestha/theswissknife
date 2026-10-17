import { describe, expect, it } from 'vitest'
import { isStaleChunkError } from './ErrorBoundary'

describe('isStaleChunkError', () => {
  it('recognises each engine’s failed dynamic import', () => {
    expect(isStaleChunkError(new TypeError('Failed to fetch dynamically imported module: https://theswissknife.com/assets/jq-abc.js'))).toBe(true)
    expect(isStaleChunkError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isStaleChunkError(new TypeError('error loading dynamically imported module: https://x/a.js'))).toBe(true)
  })

  it('leaves ordinary crashes alone', () => {
    expect(isStaleChunkError(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false)
  })
})

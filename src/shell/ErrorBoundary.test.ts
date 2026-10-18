import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { describeError, ErrorBoundary, isStaleChunkError, sanitizeMessage } from './ErrorBoundary'

const ORIGIN = 'https://theswissknife.com'
const cssError = new Error(`Unable to preload CSS for ${ORIGIN}/assets/jq-abc.css`)
const chunkError = new TypeError(`Failed to fetch dynamically imported module: ${ORIGIN}/assets/jq-abc.js`)
const crash = new TypeError("Cannot read properties of undefined (reading 'x')")

describe('isStaleChunkError', () => {
  it('recognises each engine’s failed dynamic import', () => {
    expect(isStaleChunkError(chunkError)).toBe(true)
    expect(isStaleChunkError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isStaleChunkError(new TypeError('error loading dynamically imported module: https://x/a.js'))).toBe(true)
  })

  it('recognises a tool stylesheet that failed to load', () => {
    expect(isStaleChunkError(cssError)).toBe(true)
  })

  it('leaves ordinary crashes alone', () => {
    expect(isStaleChunkError(crash)).toBe(false)
  })
})

describe('sanitizeMessage', () => {
  it('keeps the site’s own URLs as paths instead of calling them external', () => {
    expect(sanitizeMessage(cssError.message, ORIGIN)).toBe('Unable to preload CSS for /assets/jq-abc.css')
  })

  it('still hides other origins and local paths', () => {
    expect(sanitizeMessage('blocked https://evil.example/x.js', ORIGIN)).toBe('blocked [external url]')
    expect(sanitizeMessage('at /Users/me/project/src/a.ts', ORIGIN)).toBe('at [path]')
  })
})

describe('describeError', () => {
  it('offers a reload for a stale chunk or a stylesheet that failed to load', () => {
    expect(describeError(chunkError, true)).toMatchObject({ title: 'A newer version is available', reload: true })
    expect(describeError(cssError, true)).toMatchObject({ title: 'A newer version is available', reload: true })
  })

  it('says “not downloaded yet” only when it is a chunk that failed offline', () => {
    expect(describeError(chunkError, false)).toMatchObject({ title: 'Offline', reload: false })
    expect(describeError(crash, false)).toMatchObject({ title: 'Something went wrong' })
    expect(describeError(crash, false).body).toContain('Cannot read properties')
  })
})

describe('the error screen', () => {
  it('is the skip link’s #main-content target', () => {
    const boundary = new ErrorBoundary({ children: null })
    boundary.state = { error: crash }
    expect(renderToStaticMarkup(boundary.render() as never)).toContain('id="main-content"')
  })
})

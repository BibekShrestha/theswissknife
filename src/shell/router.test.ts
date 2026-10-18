/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { currentPath } from './router'

const at = (path: string) => {
  history.replaceState(null, '', path)
  return currentPath()
}

describe('currentPath', () => {
  it('reads tool slugs with or without a trailing slash', () => {
    expect(at('/')).toBe('')
    expect(at('/jq')).toBe('jq')
    expect(at('/jq/')).toBe('jq')
  })

  it('treats /index.html as the landing page', () => {
    expect(at('/index.html')).toBe('')
  })

  it('reads a tool page by its file name too (/jq.html is the page the build emits for /jq)', () => {
    expect(at('/jq.html')).toBe('jq')
  })
})

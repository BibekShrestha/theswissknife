/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { currentPath } from './router'

const at = (path: string) => {
  history.replaceState(null, '', path)
  return currentPath()
}

describe('route changes', () => {
  it('drop a handed-off payload once the user leaves its target', async () => {
    const { sendTo, takeHandoff } = await import('./handoff')
    const { navigate } = await import('./router')
    sendTo('sqlite', { name: 'x.csv', text: 'secret' })
    navigate('/jq')
    navigate('/sqlite')
    expect(takeHandoff('sqlite')).toBeNull()

    sendTo('sqlite', { name: 'x.csv', text: 'secret' })
    expect(takeHandoff('sqlite')).toEqual({ name: 'x.csv', text: 'secret' })
  })
})

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

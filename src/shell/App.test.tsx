/**
 * The shell rendered for real: palette failure isolation, the skip link and
 * canonical URL, the drawers' focus handling.
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const palette = vi.hoisted(() => ({ fail: true }))

vi.mock('./CommandPalette', () => ({
  default: function CommandPalette() {
    if (palette.fail) throw new TypeError('Failed to fetch dynamically imported module: https://theswissknife.com/assets/CommandPalette-x.js')
    return <div role="dialog" aria-modal="true" data-shell-palette><input aria-label="Search tools" /></div>
  },
}))

const { default: App } = await import('./App')
const { navigate } = await import('./router')
const { openPalette } = await import('./palette')
const { tools } = await import('./registry')

let root: Root
let host: HTMLElement

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // jsdom has no matchMedia; the shell reads it for the theme and the drawers.
  window.matchMedia = ((query: string) => ({
    matches: query.includes('max-width'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
  document.head.innerHTML = '<link rel="canonical" href="https://theswissknife.com/" />'
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

beforeEach(async () => {
  history.replaceState(null, '', '/')
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<App />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  palette.fail = true
})

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

describe('a command palette that fails to load', () => {
  it('shows a small notice and leaves the page underneath mounted', async () => {
    await act(async () => openPalette())
    await flush()
    expect(document.querySelector('.landing')).not.toBeNull()
    const notice = document.querySelector('[data-shell-palette]')
    expect(notice?.textContent).toMatch(/reload/i)
  })

  it('closes cleanly, and the next open tries again', async () => {
    await act(async () => openPalette())
    await flush()
    const close = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Close')!
    await act(async () => close.click())
    expect(document.querySelector('[data-shell-palette]')).toBeNull()

    palette.fail = false
    await act(async () => openPalette())
    await flush()
    expect(document.querySelector('[data-shell-palette] input')).not.toBeNull()
  })
})

describe('the skip link', () => {
  it('moves focus to the content without touching the URL fragment', async () => {
    history.replaceState(null, '', '/#z=state')
    const link = document.querySelector<HTMLAnchorElement>('.skip-link')!
    await act(async () => link.click())
    expect(location.hash).toBe('#z=state')
    expect(document.activeElement?.id).toBe('main-content')
  })
})

describe('the canonical link', () => {
  it('follows client-side navigation', async () => {
    const canonical = () => document.querySelector<HTMLLinkElement>('link[rel="canonical"]')!.href
    await act(async () => navigate('/no-such-tool'))
    expect(canonical()).toBe('https://theswissknife.com/')
    await act(async () => navigate('/jwt'))
    expect(canonical()).toBe('https://theswissknife.com/jwt')
    await act(async () => navigate('/'))
    expect(canonical()).toBe('https://theswissknife.com/')
  })
})

describe('the landing tool index filter', () => {
  it('matches category headings by name and keeps their numbers', async () => {
    const input = document.querySelector<HTMLInputElement>('.landing-find input')!
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(input, 'images')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // Taglines load lazily and may add tools from other categories whose
    // tagline mentions images; the category match and its number must hold either way.
    const headings = [...document.querySelectorAll('.landing-index-heading')].map((h) => h.textContent)
    expect(headings).toContainEqual(expect.stringMatching(/^07Images\d+$/))
    expect(headings).not.toContainEqual(expect.stringMatching(/^0[1-6](Data|Text|Docs|Time|PDF)/))
  })
})

describe('the landing hero search', () => {
  const type = async (value: string) => {
    const input = document.querySelector<HTMLInputElement>('.landing-find input')!
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    return input
  }

  it('lists every tool in the page, with no drawer to open', () => {
    expect(document.querySelector('.landing-menu-btn')).toBeNull()
    expect(document.querySelectorAll('.landing-index-group > a').length).toBe(tools.length)
  })

  it('opens the first match on Enter', async () => {
    const input = await type('jwt')
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(location.pathname).toBe('/jwt')
  })

  it('takes focus on /', async () => {
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: '/' })))
    expect(document.activeElement).toBe(document.querySelector('.landing-find input'))
  })
})

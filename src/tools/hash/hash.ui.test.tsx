// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HashTool from './index'
import { digest, toHex, utf8 } from './hash'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// the shared toolbar's theme hook reads prefers-color-scheme
window.matchMedia ??= ((media: string) => ({
  matches: false, media, onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  vi.restoreAllMocks()
  act(() => root?.unmount())
  host?.remove()
})

async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)) })

describe('HASH-1: digests never outlive their input', () => {
  it('hides old rows and the old match while new input hashes, and after an error', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(<HashTool />))
    await settle()
    const textarea = host.querySelector<HTMLTextAreaElement>('[aria-label="Text to hash"]')!
    await type(textarea, 'abc')
    await settle()
    const sha = toHex(await digest('SHA-256', utf8('abc')))
    expect(host.textContent).toContain(sha)
    await type(host.querySelector<HTMLInputElement>('[aria-label="Expected checksum"]')!, sha)
    expect(host.querySelector('.hash-compare')!.textContent).toContain('Matches SHA-256')

    // the next input never finishes hashing
    vi.spyOn(crypto.subtle, 'digest').mockImplementation(() => new Promise(() => {}))
    await type(textarea, 'abcd')
    await settle()
    expect(host.textContent).not.toContain(sha)
    expect(host.querySelector('.hash-compare')!.textContent).not.toContain('Matches')
    expect(host.querySelector('.hash-results')!.textContent).toContain('Computing')

    // the next one fails
    vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('boom'))
    await type(textarea, 'abc')
    await settle()
    expect(host.querySelector('.hash-results [role="alert"]')!.textContent).toContain('boom')
    expect(host.textContent).not.toContain(sha)
    expect(host.querySelector('.hash-compare')!.textContent).not.toContain('Matches')
  })
})

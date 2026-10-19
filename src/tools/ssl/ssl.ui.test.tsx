// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import SslTool from './index'
import { KU, makeCert, makeKey, pem, standardChain } from './testcerts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// the shared toolbar's theme hook reads prefers-color-scheme
window.matchMedia ??= ((media: string) => ({
  matches: false, media, onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

let root: Root | null = null
let host: HTMLDivElement | null = null
let std: Awaited<ReturnType<typeof standardChain>>

beforeAll(async () => { std = await standardChain() }, 30_000)

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

async function mount() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(<SslTool />))
  return host
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 100)) })

async function inspect(el: HTMLElement, text: string) {
  const textarea = el.querySelector<HTMLTextAreaElement>('[aria-label="PEM certificate or chain"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, text)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Inspect certificate')!.click())
  await settle()
}

describe('SSL verdict (SSL-1)', () => {
  it('is green only when every link of the supplied chain checks out', async () => {
    const el = await mount()
    await inspect(el, pem(std.leaf) + pem(std.inter) + pem(std.root))
    expect(el.querySelector('.ssl-verdict')!.textContent).toContain('Local certificate checks passed')
  })

  it('is not green for a CA:FALSE intermediate, and says which link fails', async () => {
    const leafSigner = await makeKey('ec')
    const notCa = await makeCert({ subject: 'Issuing Server', issuer: 'Test Root', key: leafSigner, signer: std.rootKey, ca: false, keyUsage: [KU.digitalSignature] })
    const leaf = await makeCert({ subject: 'www.example.com', issuer: 'Issuing Server', key: std.leafKey, signer: leafSigner, dns: ['www.example.com'] })
    const el = await mount()
    await inspect(el, pem(leaf) + pem(notCa) + pem(std.root))
    const verdict = el.querySelector('.ssl-verdict')!
    expect(verdict.textContent).not.toContain('passed')
    expect(verdict.classList.contains('ok')).toBe(false)
    const rows = [...el.querySelectorAll('.ssl-chain li')]
    expect(rows[1].textContent).toMatch(/not a CA/i)
  })
})

describe('SSL file input (SSL-7)', () => {
  it('replaces the textarea with the opened DER certificate', async () => {
    const el = await mount()
    const textarea = el.querySelector<HTMLTextAreaElement>('[aria-label="PEM certificate or chain"]')!
    await inspect(el, pem(std.root))
    const input = el.querySelector<HTMLInputElement>('input[type="file"]')!
    const file = new File([std.leaf as BlobPart], 'leaf.der')
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    await settle()
    expect(textarea.value).toBe(pem(std.leaf).trim())
    expect(el.querySelector('.ssl-verdict')!.textContent).toContain('www.example.com')
  })
})

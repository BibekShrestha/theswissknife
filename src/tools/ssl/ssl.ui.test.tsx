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
  const textarea = el.querySelector<HTMLTextAreaElement>('[aria-label="Certificates, CSRs or keys"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, text)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Inspect')!.click())
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
    const textarea = el.querySelector<HTMLTextAreaElement>('[aria-label="Certificates, CSRs or keys"]')!
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

// throwaway test keys from fixtures/generate.sh, read from disk: Vite's dev
// server refuses `*.pem?raw` imports in the jsdom environment (server.fs.deny)
const nodeModule = async (name: string) => (await import(/* @vite-ignore */ name)) as any // eslint-disable-line @typescript-eslint/no-explicit-any
let fs: { readFileSync(path: URL, encoding: 'utf8'): string }
beforeAll(async () => { fs = await nodeModule('node:fs') })
// a variable base keeps Vite from rewriting `new URL(…, import.meta.url)` into an asset import
const here = import.meta.url
const fx = (name: string) => fs.readFileSync(new URL('fixtures/' + name, here), 'utf8')

describe('SSL keys and CSRs', () => {
  it('flags a pasted private key, matches it to its certificate, and can strip it from the input', async () => {
    const el = await mount()
    await inspect(el, fx('test-rsa.cert.pem') + fx('test-rsa.pkcs8.pem'))
    expect(el.querySelector('.ssl-private')!.textContent).toContain('A private key was pasted')
    expect(el.querySelector('.ssl-diagnostics')!.textContent).toContain('Private key matches the leaf certificate')
    const card = el.querySelector('.ssl-item')!
    expect(card.textContent).toContain('2048-bit RSA')
    expect(card.textContent).toContain('Same public key as certificate 1 (test.example)')
    await act(async () => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Remove private keys from the input')!.click())
    await settle()
    const textarea = el.querySelector<HTMLTextAreaElement>('[aria-label="Certificates, CSRs or keys"]')!
    expect(textarea.value).not.toContain('PRIVATE KEY')
    expect(textarea.value).toContain('BEGIN CERTIFICATE')
    expect(el.querySelector('.ssl-private')).toBeNull()
  })

  it('turns the verdict red when the private key belongs to another certificate', async () => {
    const el = await mount()
    await inspect(el, fx('test-p256.cert.pem') + fx('test-rsa.pkcs8.pem'))
    expect(el.querySelector('.ssl-verdict')!.classList.contains('bad')).toBe(true)
    expect(el.querySelector('.ssl-diagnostics')!.textContent).toContain('No supplied private key matches')
  })

  it('shows a CSR with its requested names and a valid proof of possession, and checks the hostname against it', async () => {
    const el = await mount()
    const hostInput = el.querySelector<HTMLInputElement>('#ssl-host')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(hostInput, 'www.test.example')
      hostInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await inspect(el, fx('test-rsa.csr.pem'))
    const card = el.querySelector('.ssl-item')!
    expect(card.textContent).toContain('Proof of possession: signature valid')
    expect(card.textContent).toContain('test.example, *.test.example')
    expect(card.textContent).toContain('Requests www.test.example')
    expect(el.querySelector('.ssl-verdict')).toBeNull()
  })

  it('reports a truncated block without hiding the others', async () => {
    const el = await mount()
    await inspect(el, fx('test-ssh-ed25519.pub') + fx('test-rsa.pkcs8.pem').replace(/-----END PRIVATE KEY-----\s*$/, ''))
    expect(el.querySelector('.ssl-error')!.textContent).toMatch(/Block 2 \(PRIVATE KEY\): .*no END line/)
    expect(el.querySelector('.ssl-item')!.textContent).toContain('SHA256:')
    // a truncated private key is still flagged as pasted
    expect(el.querySelector('.ssl-private')).not.toBeNull()
  })
})

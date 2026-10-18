// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { generateKeyMaterial, signJws } from './crypto'
import DecodeView, { type DecodeViewHandle } from './DecodeView'
import GenerateView from './GenerateView'
import { b64urlDecodeString } from './jwt'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

async function render(node: React.ReactNode): Promise<HTMLDivElement> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(node))
  return host
}

const settle = (ms = 450) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

async function type(el: HTMLTextAreaElement | HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

const byLabel = <T extends HTMLElement>(root: HTMLElement, label: string) => {
  const el = root.querySelector<T>(`[aria-label="${label}"]`)
  if (!el) throw new Error(`no element labelled ${label}`)
  return el
}

const SECRET = 'your-256-bit-secret'
const decode = () => render(<DecodeView onCopy={() => {}} handleRef={createRef<DecodeViewHandle>()} />)

describe('DecodeView verification uses the token alg (JWT-1)', () => {
  it('never reports alg:none as verified, even with a matching HS256 signature', async () => {
    const el = await decode()
    await type(byLabel(el, 'Encoded token'), 'eyJhbGciOiJub25lIn0.eyJhZG1pbiI6dHJ1ZX0.yZgFNICOJlYH48MJPy8Po--HKI82wVCNUw8ePHb3dgw')
    await settle()
    const badge = el.querySelector('.sig-badge')!.textContent!
    expect(badge).not.toContain('signature verified')
    expect(badge).toContain('none')
  })

  it.each(['hs256', 'ES256K'])('does not verify a token claiming alg %s', async (alg) => {
    const token = await signJws('HS256', JSON.stringify({ alg }), '{"admin":true}', { text: SECRET, secretIsB64: false })
    const el = await decode()
    await type(byLabel(el, 'Encoded token'), token)
    await settle()
    const badge = el.querySelector('.sig-badge')!.textContent!
    expect(badge).not.toContain('signature verified')
    expect(badge).toContain(alg)
  })

  it('still verifies a well-formed HS256 token', async () => {
    const el = await decode()
    await settle()
    expect(el.querySelector('.sig-badge')!.textContent).toContain('signature verified')
  })
})

describe('DecodeView keeps decoded values faithful (JWT-4)', () => {
  it('shows and re-signs large integers exactly, and warns on duplicate keys', async () => {
    const token = await signJws('HS256', '{"alg":"HS256"}', '{"id":12345678901234567890,"admin":false,"admin":true}', { text: SECRET, secretIsB64: false })
    const el = await decode()
    await type(byLabel(el, 'Encoded token'), token)
    const payload = byLabel<HTMLTextAreaElement>(el, 'Payload JSON')
    expect(payload.value).toContain('12345678901234567890')
    expect(el.textContent).toContain('Duplicate key "admin"')
    await type(payload, payload.value.replace('"id"', '"x": 1,\n  "id"'))
    await settle(100)
    const next = byLabel<HTMLTextAreaElement>(el, 'Encoded token').value
    expect(next).not.toBe(token)
    expect(b64urlDecodeString(next.split('.')[1])).toBe('{"x":1,"id":12345678901234567890,"admin":false,"admin":true}')
    await settle()
    expect(el.querySelector('.sig-badge')!.textContent).toContain('signature verified')
  })
})

describe('DecodeView key presence (JWT-10)', () => {
  it('verifies with a whitespace-only secret, as it signs with one', async () => {
    const token = await signJws('HS256', '{"alg":"HS256"}', '{}', { text: '   ', secretIsB64: false })
    const el = await decode()
    await type(byLabel(el, 'Encoded token'), token)
    await type(byLabel(el, 'HMAC secret'), '   ')
    await settle()
    expect(el.querySelector('.sig-badge')!.textContent).toContain('signature verified')
  })
})

describe('GenerateView public key (JWT-5)', () => {
  it('re-derives the shown public key when the private key or alg changes', async () => {
    const el = await render(<GenerateView onCopy={() => {}} />)
    await type(byLabel(el, 'Signing algorithm'), 'ES256')
    await act(async () => el.querySelector<HTMLButtonElement>('.jwt-card-actions button')!.click())
    await settle(200)
    const first = byLabel<HTMLTextAreaElement>(el, 'Generated public key').value
    expect(first).toContain('BEGIN PUBLIC KEY')

    const other = await generateKeyMaterial('ES256')
    if (other.kind !== 'pair') throw new Error('expected pair')
    await type(byLabel(el, 'Private key to sign with'), other.privatePem)
    await settle(200)
    expect(byLabel<HTMLTextAreaElement>(el, 'Generated public key').value).toBe(other.publicPem)

    await type(byLabel(el, 'Signing algorithm'), 'ES384')
    await settle(200)
    expect(el.querySelector('[aria-label="Generated public key"]')).toBeNull()
  })
})

describe('GenerateView header alg follows the signing alg (JWT-6)', () => {
  it('switches the dropdown to a supported header alg and refuses an unsupported one', async () => {
    const el = await render(<GenerateView onCopy={() => {}} />)
    await type(byLabel(el, 'HMAC secret'), 'k')
    await type(byLabel(el, 'Header JSON'), '{"alg":"HS512","typ":"JWT"}')
    await settle()
    expect(byLabel<HTMLSelectElement>(el, 'Signing algorithm').value).toBe('HS512')
    const token = el.querySelector('.jwt-token-out')!.textContent!.trim()
    expect(JSON.parse(b64urlDecodeString(token.split('.')[0])).alg).toBe('HS512')
    expect(token.split('.')[2].length).toBe(86) // a 64-byte HS512 MAC

    await type(byLabel(el, 'Header JSON'), '{"alg":"none"}')
    await settle()
    expect(el.querySelector('.jwt-token-out')).toBeNull()
    expect(el.querySelector('.jwt-error')!.textContent).toContain('"none"')
  })
})

describe('JWT page landmarks', () => {
  it('renders exactly one <main id="main-content"> around both views', async () => {
    // the shared toolbar's theme hook reads prefers-color-scheme
    window.matchMedia ??= ((media: string) => ({
      matches: false, media, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
    const { default: JwtTool } = await import('./index')
    const el = await render(<JwtTool />)
    expect(el.querySelectorAll('main').length).toBe(1)
    expect(el.querySelectorAll('#main-content').length).toBe(1)
    expect(el.querySelector('main')!.querySelectorAll('.jwt-panes').length).toBe(2)
  })
})

describe('JWT form accessibility (JWT-7)', () => {
  function audit(el: HTMLElement) {
    expect(el.querySelectorAll('label label').length).toBe(0)
    for (const field of el.querySelectorAll('input, textarea, select')) {
      const named = field.getAttribute('aria-label') || field.closest('label') || (field.id && el.querySelector(`label[for="${field.id}"]`))
      expect(named, field.outerHTML).toBeTruthy()
    }
  }

  it('labels every field in both views, HMAC and asymmetric', async () => {
    const d = await decode()
    audit(d)
    await type(byLabel(d, 'Signing algorithm'), 'RS256')
    audit(d)
    act(() => root?.unmount())
    host?.remove()
    root = null
    const g = await render(<GenerateView onCopy={() => {}} />)
    audit(g)
    await type(byLabel(g, 'Signing algorithm'), 'RS256')
    audit(g)
  })
})

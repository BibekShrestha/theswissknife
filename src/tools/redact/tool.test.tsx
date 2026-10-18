/**
 * The redactor rendered in a DOM, with a stand-in Worker that runs the real
 * matcher — or hangs, like a pattern stuck backtracking.
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findRanges } from './lib/redact'
import type { MatchRequest, MatchWorkerMessage } from './lib/runner'
import RedactTool from './index'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const HANGS = '(a+)+$'
const workers: FakeWorker[] = []

class FakeWorker {
  onmessage: ((event: MessageEvent<MatchWorkerMessage>) => void) | null = null
  terminated = false
  constructor() {
    workers.push(this)
  }
  postMessage(req: MatchRequest) {
    const send = (data: MatchWorkerMessage) => queueMicrotask(() => this.onmessage?.({ data } as MessageEvent<MatchWorkerMessage>))
    const hang = req.targets.findIndex((t) => t.value === HANGS)
    if (hang >= 0) {
      for (let i = 0; i <= hang; i++) send({ type: 'progress', id: req.id, index: i })
      return
    }
    send({ type: 'result', id: req.id, report: findRanges(req.text, req.targets, { caseSensitive: req.caseSensitive }) })
  }
  terminate() {
    this.terminated = true
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  workers.length = 0
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }))
  history.replaceState(null, '', '/redact')
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const $ = <T extends Element>(selector: string) => host.querySelector<T>(selector)!
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text) || b.getAttribute('aria-label') === text)!
const settle = () => act(async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
})

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function pickTerm(value: string, regex = false) {
  const input = $<HTMLInputElement>('input[aria-label="Text or pattern to redact"]')
  type(input, value)
  const box = $<HTMLInputElement>('.redact-add input[type="checkbox"]')
  if (box.checked !== regex) act(() => box.click())
  act(() => button('Add').click())
  await settle()
}

async function setup(text: string) {
  act(() => root.render(<RedactTool />))
  await settle()
  type($<HTMLTextAreaElement>('textarea[aria-label="Source text"]'), text)
  act(() => button('Only what I pick').click())
  await settle()
}

const output = () => $<HTMLTextAreaElement>('textarea[aria-label="Redacted text"]').value

describe('redact tool', () => {
  it('matches in the worker and masks what was picked', async () => {
    await setup('Acme Corp owes 812')
    await pickTerm('Acme Corp')
    expect(output()).toBe('████ ████ owes 812')
    expect(host.textContent).toContain('8 of 18 chars hidden')
  })

  it('stops a pattern that backtracks forever and says which one (RDX-2)', async () => {
    vi.useFakeTimers()
    await setup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!')
    await pickTerm(HANGS, true)
    expect(output()).toBe('')
    expect(button('Copy redacted text').disabled).toBe(true)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    const alert = $('[role="alert"]')
    expect(alert.textContent).toContain(HANGS)
    expect(alert.textContent).toContain('was stopped')
    expect(workers[0].terminated).toBe(true)
    expect(host.textContent).toContain('too slow')
    expect(button('Copy redacted text').disabled).toBe(true)
  })

  it('keeps hand-picked terms when the share dialog applies JSON without them (RDX-1)', async () => {
    await setup('Acme Corp owes 812 to Acme Corp')
    await pickTerm('Acme Corp')
    await pickTerm('\\d+', true)
    expect(output()).toBe('████ ████ owes ███ to ████ ████')

    const opener = button('Share this scheme')
    opener.focus()
    act(() => opener.click())
    await settle()
    const dialog = $('[role="dialog"]')
    expect(dialog.contains(document.activeElement)).toBe(true)

    // the editor shows the scheme without the literal; apply it as it stands
    const json = $<HTMLTextAreaElement>('textarea[aria-label="Scheme as JSON"]')
    expect(json.value).not.toContain('Acme')
    expect(host.textContent).toContain('Applying keeps the 1 term you picked by hand')
    act(() => button('Apply JSON').click())
    await settle()

    expect($('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(opener) // focus comes back
    expect(output()).toBe('████ ████ owes ███ to ████ ████')
  })

  it('traps focus in the share dialog and closes it on Escape (A11Y-1)', async () => {
    await setup('x')
    const opener = button('Share this scheme')
    opener.focus()
    act(() => opener.click())
    await settle()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close')
    const key = (init: KeyboardEventInit) => act(() => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
    })
    key({ key: 'Tab', shiftKey: true })
    expect(document.activeElement?.textContent).toBe('Apply JSON')
    key({ key: 'Tab' })
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close')
    key({ key: 'Escape' })
    expect($('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})

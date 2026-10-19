/**
 * The share dialog and the result tabs, rendered for real in a DOM.
 * @vitest-environment jsdom
 */
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LabState } from '../share'

// Encoding is async; each call hands back a promise the test settles by hand,
// so "the link has not caught up yet" is a state the test can hold still.
const pending: { resolve: (payload: string) => void; include: { subject: boolean } }[] = []
vi.mock('../share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../share')>()),
  encodeState: (_state: LabState, include: { subject: boolean }) =>
    new Promise<string>((resolve) => pending.push({ resolve, include })),
}))

const { ShareDialog } = await import('./ShareDialog')
const { ResultTabs } = await import('./ResultTabs')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  pending.length = 0
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const state: LabState = { pattern: 'a+', flags: 'g', operation: 'match', replacement: '', subject: 'secret log line', cases: [] }
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(label))!
const key = (target: Element, init: KeyboardEventInit) => act(() => {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
})

describe('regex share dialog', () => {
  it('disables Copy until the link for the current choices is encoded (no stale subject)', async () => {
    const copy = vi.fn()
    act(() => root.render(<ShareDialog state={state} onClose={() => {}} copy={copy} />))
    await act(async () => pending.at(-1)!.resolve('without'))
    expect(button('Copy link').disabled).toBe(false)

    const subjectBox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    act(() => subjectBox.click())
    await act(async () => pending.at(-1)!.resolve('with-subject'))
    expect(pending.at(-1)!.include.subject).toBe(true)
    expect(host.querySelector<HTMLInputElement>('.regex-share-url')!.value).toContain('with-subject')

    // untick: the link that carries the subject must not be copyable any more
    act(() => subjectBox.click())
    expect(button('Copy link').disabled).toBe(true)
    expect(host.querySelector<HTMLInputElement>('.regex-share-url')!.value).toBe('')
    act(() => button('Copy link').click())
    expect(copy).not.toHaveBeenCalled()

    await act(async () => pending.at(-1)!.resolve('without-again'))
    expect(button('Copy link').disabled).toBe(false)
    act(() => button('Copy link').click())
    expect(copy).toHaveBeenCalledWith(expect.stringContaining('without-again'), 'Link')
    expect(copy.mock.calls[0][0]).not.toContain('with-subject')
  })

  it('focuses the dialog, traps Tab, closes on Escape and returns focus to the opener', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Open share</button>
          {open && <ShareDialog state={state} onClose={() => setOpen(false)} copy={() => {}} />}
        </>
      )
    }
    act(() => root.render(<Harness />))
    const opener = button('Open share')
    opener.focus()
    act(() => opener.click())
    await act(async () => pending.at(-1)!.resolve('x'))

    const dialog = host.querySelector('[role="dialog"]')!
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close')

    // Shift+Tab from the first control wraps to the last, Tab from the last wraps back
    key(document.activeElement!, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(button('Copy link'))
    key(document.activeElement!, { key: 'Tab' })
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close')

    key(document.activeElement!, { key: 'Escape' })
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})

describe('regex result tabs', () => {
  it('names the panel each tab controls and moves with the arrow keys', () => {
    function Harness() {
      const [active, setActive] = useState<'a' | 'b' | 'c'>('a')
      return <ResultTabs tabs={[['a', 'A'], ['b', 'B'], ['c', 'C']]} active={active} onSelect={setActive} panelId="panel" />
    }
    act(() => root.render(<Harness />))
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    expect(tabs.map((t) => t.getAttribute('aria-controls'))).toEqual(['panel', 'panel', 'panel'])
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1])

    tabs[0].focus()
    key(tabs[0], { key: 'ArrowRight' })
    expect(document.activeElement?.textContent).toBe('B')
    expect(document.activeElement?.getAttribute('aria-selected')).toBe('true')
    key(document.activeElement!, { key: 'ArrowLeft' })
    key(document.activeElement!, { key: 'ArrowLeft' })
    expect(document.activeElement?.textContent).toBe('C')
    key(document.activeElement!, { key: 'Home' })
    expect(document.activeElement?.textContent).toBe('A')
    key(document.activeElement!, { key: 'End' })
    expect(document.activeElement?.textContent).toBe('C')
  })
})

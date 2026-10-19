/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, describe, expect, it } from 'vitest'
import CommandPalette from './CommandPalette'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollIntoView ??= () => undefined
})

const tab = (shiftKey = false) => {
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true })
  window.dispatchEvent(event)
  return event
}

describe('the command palette', () => {
  it('keeps focus inside while open and hands it back to its opener on close', async () => {
    const opener = document.createElement('button')
    const host = document.createElement('div')
    document.body.append(opener, host)
    opener.focus()

    const root = createRoot(host)
    await act(async () => root.render(<CommandPalette path="" onClose={() => undefined} />))
    const input = host.querySelector('input')!
    expect(document.activeElement).toBe(input)

    expect(tab().defaultPrevented).toBe(true)
    expect(tab(true).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(input)

    // Focus escaped (a click on a row): Tab brings it back in.
    opener.focus()
    tab()
    expect(document.activeElement).toBe(input)

    await act(async () => root.unmount())
    expect(document.activeElement).toBe(opener)
    opener.remove()
    host.remove()
  })
})

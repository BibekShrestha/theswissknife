/**
 * The update prompt, against a fake service worker container.
 * @vitest-environment jsdom
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const container = Object.assign(new EventTarget(), {
  controller: {} as object | null,
  register: vi.fn(),
})
const waiting = { postMessage: vi.fn(), state: 'installed' }

let pwa: typeof import('./pwa')

beforeAll(async () => {
  Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true })
  container.register.mockResolvedValue(Object.assign(new EventTarget(), { waiting, installing: null }))
  pwa = await import('./pwa')
  await Promise.resolve()
})

beforeEach(() => {
  pwa.page.reload = vi.fn()
  waiting.postMessage.mockClear()
})

const banner = () => document.querySelector<HTMLElement>('.pwa-update')
const reloadButton = () => [...(banner()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Reload')!

describe('the update banner', () => {
  it('offers the waiting worker on load', () => {
    expect(banner()?.textContent).toContain('A new version is ready.')
  })

  /**
   * Two tabs show the banner; tab A's Reload activates the new worker. Tab B
   * is now controlled by it (and its old runtime entries are pruned), so its
   * own Reload must still do something.
   */
  it('says so when another tab activated the update, and Reload just reloads', () => {
    container.dispatchEvent(new Event('controllerchange'))
    expect(banner()?.textContent).toContain('A new version is active')
    expect(pwa.page.reload).not.toHaveBeenCalled()

    const reload = reloadButton()
    expect(reload.disabled).toBe(false)
    reload.click()
    expect(pwa.page.reload).toHaveBeenCalledTimes(1)
    expect(waiting.postMessage).not.toHaveBeenCalled()
  })
})

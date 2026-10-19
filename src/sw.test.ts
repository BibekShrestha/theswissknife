import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Runs the real service worker source against stubbed worker globals: the
 * routing decisions are what decide whether a returning visitor gets this
 * deploy's HTML or a stale page whose chunks are gone.
 */

const ORIGIN = 'https://theswissknife.com'

const manifest = {
  version: 'test',
  core: ['/', '/assets/index-aaa.js'],
  assets: ['/', '/assets/index-aaa.js', '/assets/jq-bbb.js', '/jq.html'],
}

type Listener = (event: unknown) => void
const listeners: Record<string, Listener> = {}

const cached = new Map<string, Response>()
const fetchMock = vi.fn<(input: unknown, init?: RequestInit) => Promise<Response>>()

beforeAll(async () => {
  vi.stubGlobal('__SW_MANIFEST__', manifest)
  vi.stubGlobal('location', { origin: ORIGIN })
  vi.stubGlobal('self', {
    addEventListener: (type: string, fn: Listener) => { listeners[type] = fn },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  })
  vi.stubGlobal('caches', {
    match: async (request: string | { url: string }) => {
      const key = typeof request === 'string' ? request : new URL(request.url).pathname
      return cached.get(key)?.clone()
    },
    open: async () => ({ put: async () => undefined }),
  })
  vi.stubGlobal('fetch', fetchMock)
  await import('./sw')
})

beforeEach(() => {
  cached.clear()
  cached.set('/', new Response('old shell'))
  cached.set('/assets/index-aaa.js', new Response('cached chunk'))
  fetchMock.mockReset()
})

/** Dispatches a fetch event and resolves with what the worker answered, or undefined if it let the request pass. */
async function dispatch(path: string, mode: RequestMode = 'cors'): Promise<Response | undefined> {
  let answer: Promise<Response> | undefined
  listeners.fetch({
    request: { method: 'GET', mode, url: `${ORIGIN}${path}` },
    respondWith: (response: Response | Promise<Response>) => { answer = Promise.resolve(response) },
  })
  return answer
}

describe('service worker routing', () => {
  it('revalidates navigations instead of trusting the HTTP cache', async () => {
    fetchMock.mockResolvedValue(new Response('new shell'))
    const response = await dispatch('/jq', 'navigate')
    expect(await response?.text()).toBe('new shell')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-cache' })
  })

  it('falls back to the precached shell when a navigation cannot reach the network', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const response = await dispatch('/jq', 'navigate')
    expect(await response?.text()).toBe('old shell')
  })

  it('does not answer a plain fetch of the shell from the precache while online', async () => {
    fetchMock.mockResolvedValue(new Response('new shell'))
    const response = await dispatch('/')
    expect(await response?.text()).toBe('new shell')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-cache' })
  })

  it('treats every HTML page as network-first, never cache-first', async () => {
    fetchMock.mockResolvedValue(new Response('jq page'))
    cached.set('/jq.html', new Response('stale jq page'))
    const response = await dispatch('/jq.html')
    expect(await response?.text()).toBe('jq page')
  })

  it('still serves hashed chunks cache-first', async () => {
    const response = await dispatch('/assets/index-aaa.js')
    expect(await response?.text()).toBe('cached chunk')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('leaves files this build does not own to the network', async () => {
    expect(await dispatch('/assets/someone-else.js')).toBeUndefined()
  })
})

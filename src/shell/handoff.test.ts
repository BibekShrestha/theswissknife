import { beforeEach, describe, expect, it, vi } from 'vitest'

const navigate = vi.fn()
vi.mock('./router', () => ({ navigate: (to: string) => navigate(to) }))

const { sendTo, takeHandoff } = await import('./handoff')

beforeEach(() => {
  navigate.mockClear()
  takeHandoff('__drain__')
})

describe('handoff', () => {
  it('delivers one payload to the named tool and navigates there', () => {
    sendTo('sqlite', { name: 'people.csv', text: 'a,b\n1,2\n' })
    expect(navigate).toHaveBeenCalledWith('/sqlite')
    expect(takeHandoff('sqlite')).toEqual({ name: 'people.csv', text: 'a,b\n1,2\n' })
  })

  it('is single use', () => {
    sendTo('sqlite', { name: 'x.csv', text: '' })
    takeHandoff('sqlite')
    expect(takeHandoff('sqlite')).toBeNull()
  })

  it('never hands a payload to a different tool, and drops it once another tool looks', () => {
    sendTo('sqlite', { name: 'x.csv', text: 'secret' })
    expect(takeHandoff('csv')).toBeNull()
    expect(takeHandoff('sqlite')).toBeNull()
  })

  it('survives arriving at the target, but not leaving for anywhere else', async () => {
    const { releaseHandoff } = await import('./handoff')
    sendTo('sqlite', { name: 'x.csv', text: 'secret' })
    releaseHandoff('sqlite')
    expect(takeHandoff('sqlite')).toEqual({ name: 'x.csv', text: 'secret' })

    // The target failed to load and the user went Back: a later visit must not auto-import.
    sendTo('sqlite', { name: 'x.csv', text: 'secret' })
    releaseHandoff('csv')
    expect(takeHandoff('sqlite')).toBeNull()
  })

  it('expires if the target never takes it', async () => {
    const { HANDOFF_TTL_MS } = await import('./handoff')
    vi.useFakeTimers()
    try {
      sendTo('sqlite', { name: 'x.csv', text: 'secret' })
      vi.advanceTimersByTime(HANDOFF_TTL_MS + 1)
      expect(takeHandoff('sqlite')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

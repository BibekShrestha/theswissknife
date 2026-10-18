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
})

import { describe, expect, it } from 'vitest'
import { tools } from './registry'
import { loadTaglines, toolMatches } from './taglines'

const jq = tools.find((tool) => tool.slug === 'jq')!

describe('toolMatches', () => {
  it('matches by name and category before taglines arrive', () => {
    expect(toolMatches(jq, 'playground', null)).toBe(true)
    expect(toolMatches(jq, 'data', null)).toBe(true)
    expect(toolMatches(jq, 'webassembly', null)).toBe(false)
  })

  it('matches tagline words once loaded', async () => {
    const taglines = await loadTaglines()
    expect(toolMatches(jq, taglines.jq.split(' ').at(-1)!, taglines)).toBe(true)
  })

  it('matches everything for an empty query', () => {
    expect(toolMatches(jq, '  ', null)).toBe(true)
  })
})

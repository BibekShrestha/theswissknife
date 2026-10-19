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

  it('matches the category’s display name, not only its id', () => {
    const image = tools.find((tool) => tool.slug === 'image')!
    // The heading says "Images"; the id is "image".
    expect(toolMatches(image, 'images', null, 'Images')).toBe(true)
  })

  it('matches everything for an empty query', () => {
    expect(toolMatches(jq, '  ', null)).toBe(true)
  })
})

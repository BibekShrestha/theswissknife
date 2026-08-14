import { describe, expect, it } from 'vitest'
import { isPaletteKey, rank, toCommands, type KeyLike } from './palette'
import { tools } from './registry'

const press = (key: string, extra: Partial<KeyLike> = {}): KeyLike => ({ key, ...extra })
const ALL = toCommands(tools)
const names = (query: string) => rank(ALL, query).map((c) => c.name)

describe('isPaletteKey', () => {
  it('opens on ⌘K and Ctrl K', () => {
    expect(isPaletteKey(press('k', { metaKey: true }))).toBe(true)
    expect(isPaletteKey(press('k', { ctrlKey: true }))).toBe(true)
    expect(isPaletteKey(press('K', { metaKey: true }))).toBe(true)
  })

  /**
   * The reason the palette exists: a bare key fires by accident, and an
   * accidental jump costs whatever was on screen.
   */
  it('ignores k with no modifier held', () => {
    expect(isPaletteKey(press('k'))).toBe(false)
    expect(isPaletteKey(press('K', { shiftKey: true }))).toBe(false)
  })

  it('ignores every other key and combination', () => {
    for (const key of ['j', '1', 'h', '?', 'Escape', 'Enter']) {
      expect(isPaletteKey(press(key, { metaKey: true }))).toBe(false)
      expect(isPaletteKey(press(key))).toBe(false)
    }
    expect(isPaletteKey(press('k', { metaKey: true, altKey: true }))).toBe(false)
    expect(isPaletteKey(press('k', { metaKey: true, shiftKey: true }))).toBe(false)
  })

  it('stays out of the way of an IME', () => {
    expect(isPaletteKey(press('k', { metaKey: true, isComposing: true }))).toBe(false)
    expect(isPaletteKey(press('Process', { metaKey: true, keyCode: 229 }))).toBe(false)
  })
})

describe('toCommands', () => {
  it('leads with the way back out of a tool', () => {
    expect(ALL[0]).toMatchObject({ to: '/', name: 'All tools' })
  })

  it('offers every registered tool', () => {
    expect(ALL.slice(1).map((c) => c.to)).toEqual(tools.map((t) => `/${t.slug}`))
  })
})

describe('rank', () => {
  it('shows everything until you type', () => {
    expect(rank(ALL, '')).toEqual(ALL)
    expect(rank(ALL, '   ')).toEqual(ALL)
  })

  it('puts a name match first', () => {
    expect(names('jq')[0]).toBe('jq playground')
    expect(names('regex')[0]).toBe('Regex lab')
  })

  it('matches a slug', () => {
    expect(names('html-table')[0]).toBe('HTML table extractor')
  })

  it('matches a word inside the name', () => {
    expect(names('lab')[0]).toBe('Regex lab')
    expect(names('decode')[0]).toBe('JWT decode & generate')
  })

  it('matches a subsequence', () => {
    expect(names('jwtg')[0]).toBe('JWT decode & generate')
  })

  it('falls back to the tagline', () => {
    expect(names('base64')).toContain('Codec studio')
    expect(names('watermark')).toContain('PDF Buddy')
  })

  it('ranks a name hit above a tagline hit', () => {
    // 'convert' is a word in the converter's name and only tagline text elsewhere
    const hits = names('convert')
    expect(hits[0]).toBe('Image converter')
    expect(hits).toContain('Unix time')
  })

  it('keeps input order when scores tie', () => {
    const tied = ['Alpha', 'Bravo', 'Charlie'].map((name, i) => ({
      to: `/${i}`,
      name,
      hint: 'a shared tagline',
      mark: '·',
    }))
    expect(rank(tied, 'shared').map((c) => c.name)).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })

  it('returns nothing for a query no tool matches', () => {
    expect(rank(ALL, 'kubernetes')).toEqual([])
  })

  it('ignores case and surrounding space', () => {
    expect(names('  JQ  ')[0]).toBe('jq playground')
  })
})

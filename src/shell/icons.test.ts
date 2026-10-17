import { describe, expect, it } from 'vitest'
import ligatureText from '../../scripts/fonts/ligatures.txt?raw'
import built from '../../scripts/fonts/icons.json'
import { findIconNames, parseLigatures, type Source } from '../../scripts/icon-names'

/**
 * The icon font is a subset: src/shell/MaterialSymbolsOutlined.woff2 holds
 * only the icons in scripts/fonts/icons.json. An icon missing from it does
 * not fail loudly anywhere else — the browser just prints its name as a word
 * where the icon should be. This is the place that notices.
 */

const files = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
})
const sources: Source[] = Object.entries(files).map(([path, text]) => ({
  path: path.replace(/^\//, ''),
  text,
}))
const ligatures = parseLigatures(ligatureText)
const used = findIconNames(sources, ligatures)
const inFont = new Set<string>(built)

const REGENERATE =
  'run `npm run icon-font` (needs `pip install fonttools brotli`) and commit scripts/fonts/ and src/shell/MaterialSymbolsOutlined.woff2'

describe('the subset icon font', () => {
  it('has every icon the source uses', () => {
    const missing = [...used].filter(([name]) => !inFont.has(name))
    expect(
      missing.map(([name, where]) => `${name} (${where.join(', ')})`),
      `icons used but not in the subset font, so they render as plain words — ${REGENERATE}`,
    ).toEqual([])
  })

  it('carries no icon the source has stopped using', () => {
    const stale = built.filter((name) => !used.has(name))
    expect(stale, `icons in the subset font that nothing uses — ${REGENERATE}`).toEqual([])
  })

  it('was built from names the full font knows', () => {
    expect(built.filter((name) => !ligatures.has(name))).toEqual([])
  })

  /**
   * Names that never appear as a literal child of the icon span: a ternary,
   * a table in another file, a function's return, a destructured tuple. If
   * the extraction stops seeing these, it has stopped seeing dynamic icons.
   */
  it.each([
    ['light_mode', 'ToolHeader theme toggle ternary'],
    ['check_circle', 'ssl statusIcon()'],
    ['merge', 'PDF Buddy tool table in lib/utils.ts'],
    ['view_column', 'SplitPdf options array'],
    ['wifi', 'QR payload types in payload.ts'],
    ['gpp_bad', 'QR scan-check tuple map'],
  ])('sees %s (%s)', (name) => {
    expect(used.has(name)).toBe(true)
  })
})

describe('findIconNames', () => {
  const known = new Set(['search', 'menu', 'close', 'csv'])

  it('reads JSX text, quoted words and template words, but only ligatures', () => {
    const text = [
      '<span className="material-symbols-outlined">',
      '  search',
      '</span>',
      "{open ? 'close' : `menu`} 'not_an_icon' \"csv\"",
    ].join('\n')
    expect([...findIconNames([{ path: 'src/a.tsx', text }], known)]).toEqual([
      ['close', ['src/a.tsx']],
      ['csv', ['src/a.tsx']],
      ['menu', ['src/a.tsx']],
      ['search', ['src/a.tsx']],
    ])
  })

  it('ignores files that cannot name an icon, tests, and anything outside src/', () => {
    const text = "const mode = 'search'"
    expect(findIconNames([{ path: 'src/a.ts', text }], known).size).toBe(0)
    const iconic = "const icon = 'search'"
    expect(findIconNames([{ path: 'src/a.test.ts', text: iconic }], known).size).toBe(0)
    expect(findIconNames([{ path: 'scripts/a.ts', text: iconic }], known).size).toBe(0)
    expect(findIconNames([{ path: 'src/a.ts', text: iconic }], known).size).toBe(1)
  })
})

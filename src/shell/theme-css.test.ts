import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs helper (Vitest empties CSS imports, so read from disk)
import { readText } from '../../scripts/read-text.mjs'

const css: string = readText('src/shell/theme.css')

const declarations = (block: string) => block.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('--') || line.startsWith('color-scheme'))

describe('theme.css', () => {
  it('keeps the OS-dark fallback identical to the chosen dark theme', () => {
    const chosen = /:root\[data-theme='dark'\] \{\n([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    const fallback = /@media \(prefers-color-scheme: dark\) \{\n {2}:root:not\(\[data-theme\]\) \{\n([\s\S]*?)\n {2}\}/.exec(css)?.[1] ?? ''
    expect(declarations(chosen).length).toBeGreaterThan(20)
    expect(declarations(fallback)).toEqual(declarations(chosen))
  })

  it('themes the page without the boot script', () => {
    expect(css).toMatch(/:root,\n:root\[data-theme='light'\] \{/)
  })
})

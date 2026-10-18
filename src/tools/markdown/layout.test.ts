import { describe, expect, it } from 'vitest'
// Vitest does not process CSS, so `?raw` would come back empty; read the file.
const { readFileSync } = (globalThis as unknown as {
  process: { getBuiltinModule(id: 'node:fs'): { readFileSync(path: URL, encoding: 'utf8'): string } }
}).process.getBuiltinModule('node:fs')
const css = readFileSync(new URL('./markdown.css', import.meta.url), 'utf8')

describe('narrow layout (MD-6)', () => {
  it('pins the hidden pane inside the work area so it cannot widen the page', () => {
    const narrow = css.slice(css.indexOf('@container (max-width: 900px)'))
    const rule = /\.md-work\[data-tab='edit'\] \.md-preview-pane,[^{]*\{([^}]*)\}/.exec(narrow)?.[1] ?? ''
    expect(rule).toMatch(/position: absolute/)
    expect(rule).toMatch(/left: 0/)
    expect(narrow).toMatch(/\.md-work \{[^}]*position: relative/)
  })
})

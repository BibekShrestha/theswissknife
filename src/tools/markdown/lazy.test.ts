import { describe, expect, it } from 'vitest'
import indexSource from './index.tsx?raw'
import mathSource from './render/math.ts?raw'
import mermaidSource from './render/mermaid.ts?raw'
import renderSource from './render/render.ts?raw'

/**
 * Source-level guard, in the spirit of src/shell/main-pages.test.ts. KaTeX and
 * mermaid are ~1.8 MB together; one static import and every visitor of this
 * tool downloads them whether their document has math or not.
 */
const staticImport = (lib: string) => new RegExp(`^import[^\\n]*from ['"]${lib}`, 'm')

describe('heavy libraries stay lazy', () => {
  it('loads katex and mermaid only through import()', () => {
    expect(mathSource).toContain("import('katex')")
    expect(mermaidSource).toContain("import('mermaid')")
    for (const source of [indexSource, mathSource, mermaidSource, renderSource]) {
      expect(source).not.toMatch(staticImport('katex'))
      expect(source).not.toMatch(staticImport('mermaid'))
    }
  })

  it('keeps the editor in its own chunk', () => {
    expect(indexSource).toContain("lazy(() => import('./editor/MarkdownEditor'))")
    expect(indexSource).not.toMatch(/^import (?!type)[^\n]*from '\.\/editor\/MarkdownEditor'/m)
  })
})

import { describe, expect, it } from 'vitest'
import { pdfTools } from './lib/utils'

/**
 * Source-level guard, like markdown/lazy.test.ts: each sub-tool is its own
 * chunk, pdf.js (1.7 MB with its worker) loads only through import(), and
 * the two pdf.js tools never pull in pdf-lib.
 */
const sources = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.ts', '!./test/**'], { query: '?raw', import: 'default', eager: true })
const staticImport = (spec: string) => new RegExp(`^import (?!type )[^\\n]*from ['"]${spec}['"]`, 'm')

describe('PDF Buddy stays lazy', () => {
  it('loads every sub-tool through lazy(import())', () => {
    const index = sources['./index.tsx']
    expect(pdfTools).toHaveLength(13)
    for (const file of Object.keys(sources).filter((f) => f.startsWith('./tools/'))) {
      const name = file.replace(/^\.\/tools\/|\.tsx$/g, '')
      expect(index).toContain(`lazy(() => import('./tools/${name}')`)
      expect(index).not.toMatch(new RegExp(`^import [^\\n]*'\\./tools/${name}'`, 'm'))
    }
  })

  it('imports pdf.js only dynamically, from lib/pdfjs.ts', () => {
    for (const [file, text] of Object.entries(sources)) expect(text, file).not.toMatch(staticImport('pdfjs-dist'))
    expect(sources['./lib/pdfjs.ts']).toContain("import('pdfjs-dist')")
  })

  it('keeps pdf-lib out of PDF to Text and PDF to Image', () => {
    for (const file of ['./tools/PdfToText.tsx', './tools/PdfToImage.tsx', './ops/read.ts', './lib/errors.ts']) {
      expect(sources[file], file).not.toMatch(staticImport('pdf-lib'))
      expect(sources[file], file).not.toMatch(/from '\.\.?\/(lib\/)?load'/)
    }
  })
})

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
    expect(pdfTools).toHaveLength(15)
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

  it('runs every pdf-lib pipeline in the worker, never on the main thread', () => {
    // the screens, the runner and the protocol may name ops/ only for types (erased) or the pdf-lib-free helpers
    const pdfLibFree = /^(lib\/(errors|files|utils|pages|pdfjs|winansi|stamp)|ops\/(read|imagekind)|runner|protocol|components\/[A-Za-z]+|fillsign\/[A-Za-z]+)$/
    const resolve = (from: string, spec: string) => {
      const parts = from.replace(/^\.\//, '').split('/').slice(0, -1)
      for (const p of spec.split('/')) {
        if (p === '..') parts.pop()
        else if (p !== '.') parts.push(p)
      }
      return parts.join('/')
    }
    // fillsign/ holds Fill & Sign's screen parts, so it is checked like the screens; so are the pdf-lib-free lib helpers
    const helpers = ['./lib/winansi.ts', './lib/stamp.ts', './ops/imagekind.ts']
    const mainThread = Object.keys(sources).filter((f) => /^\.\/(tools|components|fillsign)\//.test(f) || ['./index.tsx', './runner.ts', './protocol.ts', ...helpers].includes(f))
    for (const file of mainThread) {
      const text = sources[file]
      expect(text, file).not.toMatch(staticImport('pdf-lib'))
      for (const [, spec] of text.matchAll(/^import (?!type )[^\n]*from '([^']+)'/gm)) {
        const inFolder = spec.startsWith('.') && !resolve(file, spec).startsWith('shell/')
        if (inFolder && !spec.endsWith('.css')) expect(resolve(file, spec), `${file} imports ${spec}`).toMatch(pdfLibFree)
      }
    }
    expect(sources['./runner.ts']).toContain("new Worker(new URL('./pdf.worker.ts', import.meta.url)")
    for (const tool of pdfTools.filter((t) => !['pdf-to-text', 'pdf-to-image'].includes(t.id))) {
      const screen = Object.entries(sources).find(([f, text]) => f.startsWith('./tools/') && text.includes(`runPdfJob('${tool.id}'`))
      expect(screen, `${tool.id} runs through runPdfJob`).toBeDefined()
    }
  })

  it('keeps pdf-lib out of PDF to Text and PDF to Image', () => {
    for (const file of ['./tools/PdfToText.tsx', './tools/PdfToImage.tsx', './ops/read.ts', './lib/errors.ts']) {
      expect(sources[file], file).not.toMatch(staticImport('pdf-lib'))
      expect(sources[file], file).not.toMatch(/from '\.\.?\/(lib\/)?load'/)
    }
  })
})

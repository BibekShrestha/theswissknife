import { describe, expect, it } from 'vitest'
import baseline from './a11y-baseline.json'

const raw = import.meta.glob<string>(['/src/**/*.tsx', '!/src/**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
})
const files = Object.entries(raw).map(([path, text]) => ({ path: path.replace(/^\//, ''), text }))

/**
 * Icon spans render their ligature name as text ("content_copy"), which
 * screen readers read aloud unless the span is aria-hidden. The icon's
 * meaning belongs on the control (aria-label / visible text).
 */
function unhiddenIcons(source: string): number {
  const tags = source.match(/<span\b[^>]*material-symbols-outlined[^>]*>/g) ?? []
  return tags.filter((tag) => !/\baria-hidden\b/.test(tag)).length
}

describe('accessibility guards', () => {
  it('counts icon spans without aria-hidden', () => {
    expect(unhiddenIcons('<span className="material-symbols-outlined">copy</span>')).toBe(1)
    expect(unhiddenIcons('<span className="material-symbols-outlined" aria-hidden>copy</span>')).toBe(0)
    expect(unhiddenIcons('<span aria-hidden="true" className={`material-symbols-outlined ${x}`}>copy</span>')).toBe(0)
  })

  it('hides every icon span from screen readers (no new offenders; the baseline only shrinks)', () => {
    const known = baseline.unhiddenIcons as Record<string, number>
    const over: string[] = []
    const stale: string[] = []
    for (const { path, text } of files) {
      const count = unhiddenIcons(text)
      const allowed = known[path] ?? 0
      if (count > allowed) over.push(`${path}: ${count} (allowed ${allowed})`)
      if (count < allowed) stale.push(`${path}: ${count} (baseline says ${allowed})`)
    }
    expect(over, 'add aria-hidden to these icon spans and put the label on the button instead').toEqual([])
    expect(stale, 'fewer unhidden icons than the baseline — lower src/shell/a11y-baseline.json to match').toEqual([])
  })

  it('gives every tool a #main-content landmark for the skip link', () => {
    const tools = new Set(files.map((f) => /^src\/tools\/([^/]+)\//.exec(f.path)?.[1]).filter(Boolean))
    const missing = [...tools].filter((tool) => !files.some((f) => f.path.startsWith(`src/tools/${tool}/`) && f.text.includes('id="main-content"')))
    expect(tools.size).toBeGreaterThan(10)
    expect(missing).toEqual([])
  })

  it('renders toasts through the shared always-mounted <Toast>', () => {
    const inline = files.filter((f) => f.path !== 'src/shell/Toast.tsx' && f.text.includes('className="shell-toast"'))
    expect(inline.map((f) => f.path)).toEqual([])
  })
})

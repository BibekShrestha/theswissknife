import { describe, expect, it } from 'vitest'
import { canonicalJson, computeDiff, diffWords, splitLines, type DiffOptions, type DiffResult } from './compute'
import { unifiedPatch } from './patch'

const text: DiffOptions = { mode: 'text', ignoreWhitespace: false, ignoreCase: false }
const json: DiffOptions = { ...text, mode: 'json' }

function ok(result: ReturnType<typeof computeDiff>): DiffResult {
  if ('error' in result) throw new Error(result.error)
  return result
}

/** Applies a unified diff the way `patch` would, to prove the output is usable. */
function applyPatch(original: string, patch: string): string {
  const src = splitLines(original)
  const out: string[] = []
  let noEol = src.noEol
  let ai = 0
  const lines = patch.split('\n').slice(2)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const header = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@$/.exec(line)
    if (header) {
      const start = Number(header[1]) - (header[2] === '0' ? 0 : 1)
      while (ai < start) out.push(src.lines[ai++])
      continue
    }
    if (line.startsWith(' ')) { expect(src.lines[ai]).toBe(line.slice(1)); out.push(src.lines[ai++]) }
    else if (line.startsWith('-')) { expect(src.lines[ai]).toBe(line.slice(1)); ai++ }
    else if (line.startsWith('+')) { out.push(line.slice(1)); noEol = lines[i + 1] === '\\ No newline at end of file' }
  }
  while (ai < src.lines.length) out.push(src.lines[ai++])
  if (lines.some((l, i) => l === '\\ No newline at end of file' && lines[i - 1]?.startsWith('-')) && !lines.some((l, i) => l === '\\ No newline at end of file' && lines[i - 1]?.startsWith('+'))) noEol = false
  return out.join('\n') + (out.length && !noEol ? '\n' : '')
}

describe('computeDiff (text)', () => {
  it('reports added and removed lines', () => {
    const result = ok(computeDiff('a\nb\nc\n', 'a\nB\nc\nd\n', text))
    expect(result.removed).toBe(1)
    expect(result.added).toBe(2)
    expect(result.blocks.map((b) => b.type)).toEqual(['equal', 'change', 'equal', 'change'])
  })

  it('ignores whitespace and case when asked', () => {
    expect(ok(computeDiff('  a   b\nX\n', 'a b  \nx\n', { ...text, ignoreWhitespace: true, ignoreCase: true })).added).toBe(0)
    expect(ok(computeDiff('a b\n', 'a  b\n', text)).added).toBe(1)
  })

  it('compares CRLF and LF text by content and says so', () => {
    const result = ok(computeDiff('a\r\nb\r\n', 'a\nb\n', text))
    expect(result.added).toBe(0)
    expect(result.notes[0]).toMatch(/Line endings differ \(original CRLF, changed LF\)/)
  })

  it('treats a missing final newline as a change', () => {
    const result = ok(computeDiff('a\nb', 'a\nb\n', text))
    expect(result.removed).toBe(1)
    expect(result.added).toBe(1)
    expect(result.notes.join()).toMatch(/original text is missing a newline/)
  })

  it('highlights the changed words of paired lines', () => {
    const result = ok(computeDiff('const answer = 41;\n', 'const answer = 42;\n', text))
    expect(result.inlineA[0]).toEqual([['const answer = ', false], ['41', true], [';', false]])
    expect(result.inlineB[0]).toEqual([['const answer = ', false], ['42', true], [';', false]])
  })
})

describe('diffWords', () => {
  it('skips lines with too little in common', () => {
    expect(diffWords('completely different', 'nothing alike here at all')).toBeNull()
  })
})

describe('computeDiff (json)', () => {
  it('ignores key order and formatting', () => {
    expect(ok(computeDiff('{"b":1,"a":[1,2]}', '{\n  "a": [1, 2],\n  "b": 1\n}', json)).added).toBe(0)
  })

  it('keeps array order significant', () => {
    expect(ok(computeDiff('[1,2]', '[2,1]', json)).added).toBeGreaterThan(0)
  })

  it('reports which side is invalid', () => {
    expect(computeDiff('{}', '{"a":', json)).toEqual({ error: expect.stringMatching(/^Changed is not valid JSON/) })
  })

  it('warns about duplicate keys', () => {
    expect(ok(computeDiff('{"a":1,"a":2}', '{"a":2}', json)).notes[0]).toMatch(/Duplicate keys.*original/)
    expect(ok(computeDiff('{"a":{"x":1},"b":{"x":1}}', '{}', json)).notes).toEqual([])
  })

  it('keeps big integers exact when the engine exposes source text', () => {
    const probe = JSON.parse('1', (_k, v, ctx?: { source?: string }) => ctx?.source ?? v)
    const canonical = canonicalJson('{"id": 9007199254740993}', 'x')
    if (probe === '1') expect(canonical).toEqual({ text: '{\n  "id": 9007199254740993\n}\n', duplicates: false })
  })
})

describe('unifiedPatch', () => {
  it('matches diff -u for a simple change', () => {
    const result = ok(computeDiff('a\nb\nc\n', 'a\nx\nc\n', text))
    expect(unifiedPatch(result, 'old', 'new')).toBe('--- old\n+++ new\n@@ -1,3 +1,3 @@\n a\n-b\n+x\n c\n')
  })

  it('is empty when nothing changed', () => {
    expect(unifiedPatch(ok(computeDiff('a\n', 'a\n', text)), 'a', 'b')).toBe('')
  })

  it('marks a missing newline at end of file', () => {
    const patch = unifiedPatch(ok(computeDiff('a\n', 'a\nb', text)), 'a', 'b')
    expect(patch).toBe('--- a\n+++ b\n@@ -1 +1,2 @@\n a\n+b\n\\ No newline at end of file\n')
  })

  it('names the line before an empty range', () => {
    expect(unifiedPatch(ok(computeDiff('', 'a\n', text)), 'a', 'b')).toBe('--- a\n+++ b\n@@ -0,0 +1 @@\n+a\n')
  })

  it('round-trips through a patch applier on random edits', () => {
    let seed = 11
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) >>> 0; return seed % n }
    for (let round = 0; round < 200; round++) {
      const a = Array.from({ length: rand(60) }, () => `line ${rand(8)}`)
      const b = a.flatMap((line) => (rand(8) === 0 ? [] : rand(8) === 0 ? [line, `new ${rand(8)}`] : rand(10) === 0 ? [`edit ${rand(8)}`] : [line]))
      const left = a.join('\n') + (rand(2) && a.length ? '\n' : '')
      const right = b.join('\n') + (rand(2) && b.length ? '\n' : '')
      const patch = unifiedPatch(ok(computeDiff(left, right, text)), 'a', 'b', rand(4))
      if (patch) expect(applyPatch(left, patch)).toBe(right)
      else expect(left).toBe(right)
    }
  })
})

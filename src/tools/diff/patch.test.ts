import { describe, expect, it } from 'vitest'
import { computeDiff, type DiffOptions, type DiffResult } from './compute'
import { patchLabels, unifiedPatch } from './patch'

const text: DiffOptions = { mode: 'text', ignoreWhitespace: false, ignoreCase: false }

function ok(result: ReturnType<typeof computeDiff>): DiffResult {
  if ('error' in result) throw new Error(result.error)
  return result
}

const patchOf = (left: string, right: string, options = text) => unifiedPatch(ok(computeDiff(left, right, options)), 'a/f', 'b/f')

// ---- real patch tools, when the machine has them -------------------------
// Loaded through a variable so neither tsc nor the bundler resolves node:*.
const nodeModule = async (name: string) => (await import(/* @vite-ignore */ name)) as any // eslint-disable-line @typescript-eslint/no-explicit-any
const cp = await nodeModule('node:child_process')
const fs = await nodeModule('node:fs')
const os = await nodeModule('node:os')
const path = await nodeModule('node:path')

const has = (cmd: string, args: string[]) => {
  try {
    return cp.spawnSync(cmd, args, { encoding: 'utf8' }).status === 0
  } catch {
    return false
  }
}
const hasPatch = has('patch', ['--version'])
const hasGit = has('git', ['--version'])

/** Writes `original` as the file the labels name, applies the patch with the tool, returns the file's bytes. */
function applyWith(tool: 'patch' | 'git', original: string, patch: string, name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-patch-'))
  try {
    fs.writeFileSync(path.join(dir, name), original, 'latin1')
    fs.writeFileSync(path.join(dir, 'changes.diff'), patch, 'latin1')
    const run = tool === 'patch'
      ? cp.spawnSync('patch', ['-p1', '--batch', '-i', 'changes.diff'], { cwd: dir, encoding: 'utf8' })
      : cp.spawnSync('git', ['apply', '--unsafe-paths', '--whitespace=nowarn', 'changes.diff'], { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_DIR: path.join(dir, 'no-repo') } })
    if (run.status !== 0) throw new Error(`${tool} failed: ${run.stdout}${run.stderr}`)
    return fs.readFileSync(path.join(dir, name), 'latin1')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

declare const process: { env: Record<string, string> }

const EOL_CASES: [string, string, string][] = [
  ['a CRLF file', 'one\r\ntwo\r\nthree\r\n', 'one\r\n2\r\nthree\r\n'],
  ['LF to CRLF only', 'one\ntwo\nthree\n', 'one\r\ntwo\r\nthree\r\n'],
  ['CRLF to LF only', 'one\r\ntwo\r\n', 'one\ntwo\n'],
  ['a CR-only file', 'one\rtwo\rthree\r', 'one\rTWO\rthree\r'],
  ['a stray carriage return mid-line', 'a\rb\nc\nd\n', 'a\rb\nC\nd\n'],
  ['mixed endings and a missing final newline', 'x\r\ny\nz', 'x\r\ny\r\nz\n'],
]

describe('patches keep every byte of the line endings (DIF-1)', () => {
  it('writes each line with its own terminator', () => {
    expect(patchOf('one\r\ntwo\r\n', 'one\r\n2\r\n')).toBe('--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n one\r\n-two\r\n+2\r\n')
  })

  it('turns a line-ending-only change into changed lines, though the view calls the texts equal', () => {
    const result = ok(computeDiff('a\nb\n', 'a\r\nb\r\n', text))
    expect(result.added).toBe(0)
    expect(unifiedPatch(result, 'a/f', 'b/f')).toBe('--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n-a\n-b\n+a\r\n+b\r\n')
    expect(result.notes.join(' ')).toMatch(/the patch converts them/)
  })

  it.each(EOL_CASES)('applies with patch: %s', (_label, left, right) => {
    if (!hasPatch) return
    expect(applyWith('patch', left, patchOf(left, right), 'f')).toBe(right)
  })

  it.each(EOL_CASES)('applies with git apply: %s', (_label, left, right) => {
    if (!hasGit) return
    expect(applyWith('git', left, patchOf(left, right), 'f')).toBe(right)
  })
})

describe('patch labels (DIF-2)', () => {
  it('use a/ and b/ prefixes on the original name so patch -p1 and git apply find the file', () => {
    expect(patchLabels('original', 'changed')).toEqual(['a/original', 'b/original'])
    const left = 'keep\nold\n'
    const right = 'keep\nnew\n'
    const [la, lb] = patchLabels('original', 'changed')
    const patch = unifiedPatch(ok(computeDiff(left, right, text)), la, lb)
    if (hasGit) expect(applyWith('git', left, patch, 'original')).toBe(right)
    if (hasPatch) expect(applyWith('patch', left, patch, 'original')).toBe(right)
  })

  it('writes no patch in JSON mode: the re-printed documents are neither input', () => {
    const result = ok(computeDiff('{"b":1,"a":2}', '{"a":2,"b":3}', { ...text, mode: 'json' }))
    expect(result.added).toBe(1)
    expect(result.patch).toBeNull()
    expect(unifiedPatch(result, 'a/x', 'b/x')).toBe('')
  })
})

describe('patch building is linear (DIF-4)', () => {
  it('writes 20,000 separate hunks in linear work', () => {
    // built directly: 20,000 one-line changes, each between 7 equal lines
    const n = 160_000
    const a = Array.from({ length: n }, (_, i) => `line ${i}`)
    const b = a.map((line, i) => (i % 8 === 0 ? `${line} changed` : line))
    const blocks: DiffResult['blocks'] = []
    for (let i = 0; i < n; i += 8) {
      blocks.push({ type: 'change', aStart: i, aEnd: i + 1, bStart: i, bEnd: i + 1 })
      blocks.push({ type: 'equal', aStart: i + 1, aEnd: i + 8, bStart: i + 1, bEnd: i + 8 })
    }
    // counts every read of a block, so the bound is exact rather than a timing
    let reads = 0
    const counted = new Proxy(blocks, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads++
        return Reflect.get(target, key, receiver)
      },
    })
    const side = (lines: string[]) => ({ lines, noEol: false, eol: 'LF' as const })
    const result: DiffResult = { a: side(a), b: side(b), blocks: counted, patch: { a: side(a), b: side(b), blocks: counted }, inlineA: {}, inlineB: {}, added: n / 8, removed: n / 8, notes: [] }
    const patch = unifiedPatch(result, 'a/f', 'b/f', 1)
    expect(patch.split('\n@@ ').length - 1).toBe(20_000)
    // the quadratic version walked the blocks from the start for every hunk:
    // ~4 × 10^8 reads here
    expect(reads).toBeLessThanOrEqual(5 * blocks.length)
  })
})

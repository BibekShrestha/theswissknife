import { beforeAll, describe, expect, it } from 'vitest'
import { loadJq, type Jq } from 'jq-wasm'
import { foldPaths } from './context'

// The exact query fetchPathsIndex sends (kept in sync with jqTool.ts).
const INDEX_QUERY =
  '[limit(20000; inputs | paths)] | map(map(if type == "number" then "[]" else tostring end)) | unique'

let jq: Jq

beforeAll(async () => {
  jq = await loadJq()
}, 30_000)

function index(input: string, flags: string[] = []) {
  const res = jq.raw(input, INDEX_QUERY, ['-n', '-c', ...flags])
  expect(res.exitCode).toBe(0)
  return foldPaths(JSON.parse(res.stdout) as string[][])
}

describe('paths-index query against real jq', () => {
  it('indexes plain JSON', () => {
    const idx = index('{"repos": [{"name": "jq", "stars": 3}], "total": 1}')
    expect([...(idx.children.get('') ?? [])].sort()).toEqual(['repos', 'total'])
    expect([...(idx.children.get('.repos[]') ?? [])].sort()).toEqual(['name', 'stars'])
  })

  it('indexes multi-document input', () => {
    const idx = index('{"a": 1}\n{"b": 2}')
    expect([...(idx.children.get('') ?? [])].sort()).toEqual(['a', 'b'])
  })

  it('with -s the docs sit under an array hop', () => {
    const idx = index('{"a": 1}\n{"b": 2}', ['-s'])
    expect(idx.children.get('')).toBeUndefined()
    expect([...(idx.children.get('[]') ?? [])].sort()).toEqual(['a', 'b'])
  })

  it('with -R raw lines yield no keys', () => {
    const idx = index('hello\nworld', ['-R'])
    expect(idx.allKeys.size).toBe(0)
  })

  it('tolerates scalars and empty input', () => {
    expect(index('42').allKeys.size).toBe(0)
    expect(index('').allKeys.size).toBe(0)
  })
})

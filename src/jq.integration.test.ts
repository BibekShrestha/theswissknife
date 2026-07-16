import { beforeAll, describe, expect, it } from 'vitest'
import { loadJq, type Jq } from 'jq-wasm'
import { examples } from './examples'
import { cheatsheet } from './cheatsheet'
import { buildInvocation } from './flags'
import { defaultOptions } from './types'

// Runs the REAL wasm jq — the same engine the app ships — against every
// example and cheatsheet snippet, so a jq upgrade that removes a builtin
// (e.g. leaf_paths in 1.8) or breaks a flag fails CI instead of users.

let jq: Jq

beforeAll(async () => {
  jq = await loadJq()
}, 30_000)

describe('examples', () => {
  it.each(examples.map((ex) => [ex.name, ex] as const))('%s', (_name, ex) => {
    const options = { ...defaultOptions, ...(ex.options ?? {}) }
    const inv = buildInvocation(ex.filter, options)
    expect(inv.error).toBeUndefined()
    const res = jq.raw(ex.input, inv.query, inv.flags)
    expect(res.exitCode).toBe(0)
    expect(res.stdout.length).toBeGreaterThan(0)
  })
})

describe('cheatsheet snippets compile on this jq build', () => {
  it('no snippet hits a compile error (exit 3)', { timeout: 60_000 }, () => {
    const broken: string[] = []
    for (const section of cheatsheet) {
      for (const item of section.items) {
        // -n exercises compilation; runtime type errors against null are fine
        const res = jq.raw('null', item.code, ['-n', '--arg', 'x', '1'])
        if (res.exitCode === 3) broken.push(`[${section.title}] ${item.code}: ${res.stderr.split('\n')[0]}`)
      }
    }
    expect(broken).toEqual([])
  })
})

describe('argv size guard', () => {
  it('buildInvocation blocks values that would crash the wasm', () => {
    const inv = buildInvocation('.', {
      ...defaultOptions,
      namedArgs: [{ kind: 'arg' as const, name: 'v', value: 'x'.repeat(600 * 1024) }],
    })
    expect(inv.error).toBeDefined()
  })

  it('values at the 512 KB boundary still run', () => {
    const value = 'x'.repeat(512 * 1024)
    const inv = buildInvocation('$v | length', {
      ...defaultOptions,
      nullInput: true,
      namedArgs: [{ kind: 'arg' as const, name: 'v', value }],
    })
    expect(inv.error).toBeUndefined()
    const res = jq.raw('null', inv.query, inv.flags)
    expect(res.exitCode).toBe(0)
    expect(res.stdout.trim()).toBe(String(512 * 1024))
  })
})

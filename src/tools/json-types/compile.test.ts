/**
 * The generated code must be valid and must accept the samples it came from.
 *
 * - TypeScript and Zod: compiled by the repo's own `typescript` (tsc 7) with
 *   --strict --exactOptionalPropertyTypes, every sample assigned to the root
 *   type as a literal; a deliberately wrong sample must fail.
 * - Zod at runtime: zod is not a dependency, so the schemas run against
 *   zodlite.ts, a structural stand-in for the Zod 4 calls the emitter writes.
 * - JSON Schema: checked structurally (every $ref resolves).
 * - Go: when a Go toolchain is installed, every case is compiled and each
 *   sample decoded into the root type (unknown fields disallowed).
 * - Python: when python3 is installed, every file is compiled; TypedDict files
 *   are executed on 3.11+, pydantic models validate the samples when pydantic
 *   is importable.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { runInference, type InferOptions } from './engine'
import type { TsOptions } from './emit/typescript'
import { corpus, defaults, samplesOf, type Case } from './testkit'
import { loadZod } from './zodlite'

interface SpawnResult {
  status: number | null
  stdout: string
  stderr: string
  error?: Error
}

const { process: proc } = globalThis as unknown as {
  process: {
    execPath: string
    env: Record<string, string | undefined>
    getBuiltinModule(id: 'node:fs'): {
      mkdtempSync(prefix: string): string
      mkdirSync(path: string, options: { recursive: true }): void
      writeFileSync(path: string, data: string): void
      rmSync(path: string, options: { recursive: true; force: true }): void
    }
    getBuiltinModule(id: 'node:os'): { tmpdir(): string }
    getBuiltinModule(id: 'node:child_process'): {
      spawnSync(command: string, args: string[], options: { cwd?: string; encoding: 'utf8'; timeout?: number; env?: Record<string, string | undefined> }): SpawnResult
    }
  }
}
const fs = proc.getBuiltinModule('node:fs')
const os = proc.getBuiltinModule('node:os')
const { spawnSync } = proc.getBuiltinModule('node:child_process')

const generate = (c: Case, options: Partial<InferOptions>) => {
  const result = runInference(c.text, { ...defaults, ...c.options, ...options, ts: { ...defaults.ts, ...options.ts } })
  if (!result.ok) throw new Error(`${c.name}: ${JSON.stringify(result)}`)
  return result.code
}

const fileName = (name: string) => name.replace(/[^a-z0-9]/gi, '_')

const tsVariants: { id: string; ts: TsOptions; checkSamples: boolean }[] = [
  { id: 'iface', ts: { declaration: 'interface', optional: 'question', readonly: false }, checkSamples: true },
  { id: 'alias', ts: { declaration: 'type', optional: 'question-undefined', readonly: true }, checkSamples: true },
  // `key: T | undefined` makes the key required, so samples that omit it can't be assigned — compile only.
  { id: 'undef', ts: { declaration: 'interface', optional: 'undefined', readonly: false }, checkSamples: false },
]

function tempDir(prefix: string) {
  return fs.mkdtempSync(`${os.tmpdir()}/${prefix}`)
}

const tool = (command: string, args: string[]) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 20_000 })
  return !result.error && result.status === 0 ? result.stdout + result.stderr : null
}

describe('TypeScript and Zod output compile with tsc', () => {
  let output = ''
  let status: number | null = null

  beforeAll(() => {
    const dir = tempDir('json-types-tsc-')
    const files: string[] = []
    const write = (name: string, text: string) => {
      fs.writeFileSync(`${dir}/${name}`, text)
      files.push(name)
    }
    write('zod.d.ts', "declare module 'zod' {\n  export const z: any\n  export namespace z {\n    export type infer<T> = T\n  }\n}\n")
    for (const c of corpus) {
      const base = fileName(c.name)
      for (const variant of tsVariants) {
        write(`${base}_${variant.id}.ts`, generate(c, { target: 'typescript', ts: variant.ts }))
        if (variant.checkSamples) {
          const checks = samplesOf(c).map((sample, index) => `export const s${index}: Root = ${sample};`)
          write(`${base}_${variant.id}.check.ts`, `import type { Root } from './${base}_${variant.id}';\n${checks.join('\n')}\n`)
        }
      }
      write(`${base}_zod.ts`, generate(c, { target: 'zod' }))
      write(`${base}_zod_ro.ts`, generate(c, { target: 'zod', ts: { ...defaults.ts, readonly: true } }))
    }
    // The harness must be able to fail: a number where the type says string.
    write('wrong_iface.ts', generate({ name: 'wrong', text: '{"name":"a","tags":["x"]}' }, { target: 'typescript' }))
    write('wrong_iface.bad.ts', "import type { Root } from './wrong_iface';\nexport const s0: Root = {\"name\": 1, \"tags\": [\"x\"]};\nexport const s1: Root = {\"tags\": []};\n")
    const tsc = new URL('../../../node_modules/typescript/bin/tsc', import.meta.url).pathname
    const result = spawnSync(proc.execPath, [tsc, '--noEmit', '--strict', '--exactOptionalPropertyTypes', '--skipLibCheck', '--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'bundler', '--pretty', 'false', ...files], { cwd: dir, encoding: 'utf8', timeout: 60_000 })
    output = result.stdout + result.stderr + (result.error ? String(result.error) : '')
    status = result.status
    fs.rmSync(dir, { recursive: true, force: true })
  }, 90_000)

  it('reports errors only for the deliberately wrong sample', () => {
    const lines = output.split('\n').filter((line) => /error TS\d+/.test(line))
    expect(status).not.toBe(0)
    expect(lines.filter((line) => !line.startsWith('wrong_iface.bad.ts'))).toEqual([])
    // Both the wrong type and the missing required key are caught.
    expect(lines.filter((line) => line.startsWith('wrong_iface.bad.ts(2,'))).not.toEqual([])
    expect(lines.filter((line) => line.startsWith('wrong_iface.bad.ts(3,'))).not.toEqual([])
  })
})

describe('Zod schemas accept their samples (zodlite stand-in)', () => {
  for (const c of corpus) {
    it(c.name, () => {
      for (const readonly of [false, true]) {
        const schema = loadZod(generate(c, { target: 'zod', ts: { ...defaults.ts, readonly } }), 'Root')
        for (const sample of samplesOf(c)) expect(schema.safeParse(JSON.parse(sample)).success, sample.slice(0, 120)).toBe(true)
      }
    })
  }

  it('and reject what the samples rule out', () => {
    const api = loadZod(generate(corpus.find((c) => c.name === 'api')!, { target: 'zod' }), 'Root')
    const good = JSON.parse(samplesOf(corpus[0])[0])
    expect(api.safeParse(good).success).toBe(true)
    expect(api.safeParse({ ...good, id: 'one' }).success).toBe(false)
    expect(api.safeParse({ ...good, created: 'yesterday' }).success).toBe(false)
    expect(api.safeParse({ ...good, meta: { extra: 1 } }).success).toBe(false)
    const { user_name: _dropped, ...missing } = good
    expect(api.safeParse(missing).success).toBe(false)
    expect(api.safeParse({ ...good, orders: [{ ...good.orders[0], status: 'lost' }] }).success).toBe(false)
    expect(api.safeParse({ ...good, orders: [{ ...good.orders[0], note: undefined }] }).success).toBe(true)
    const proto = loadZod(generate({ name: 'proto', text: '{"__proto__":{"a":1}}' }, { target: 'zod' }), 'Root')
    expect(proto.safeParse(JSON.parse('{"__proto__":{"a":1}}')).success).toBe(true)
    expect(proto.safeParse(JSON.parse('{"__proto__":{"a":"x"}}')).success).toBe(false)
  })
})

describe('JSON Schema output', () => {
  for (const c of corpus) {
    it(`${c.name}: parses, declares 2020-12 and every $ref resolves`, () => {
      const schema = JSON.parse(generate(c, { target: 'jsonschema' }))
      expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
      const refs = JSON.stringify(schema).match(/"\$ref":"#\/\$defs\/[^"]+"/g) ?? []
      for (const ref of refs) expect(schema.$defs?.[ref.slice(16, -1)], ref).toBeDefined()
    })
  }
})

const goVersion = tool('go', ['version'])

describe.skipIf(!goVersion)('Go structs compile and decode their samples', () => {
  it('every case', () => {
    const dir = tempDir('json-types-go-')
    fs.writeFileSync(`${dir}/go.mod`, 'module check\n\ngo 1.21\n')
    const imports: string[] = []
    const calls: string[] = []
    corpus.forEach((c, index) => {
      const pkg = `c${index}`
      const result = runInference(c.text, { ...defaults, ...c.options, target: 'go' })
      if (!result.ok) throw new Error(c.name)
      const strict = !result.notes.some((note) => note.text.startsWith('Keys a Go struct tag'))
      fs.mkdirSync(`${dir}/${pkg}`, { recursive: true })
      fs.writeFileSync(`${dir}/${pkg}/model.go`, result.code.replace(/^package model$/m, `package ${pkg}`))
      fs.writeFileSync(`${dir}/${pkg}/check.go`, `package ${pkg}

import (
	"bytes"
	"encoding/json"
)

func Check(samples []string) error {
	for _, sample := range samples {
		var value Root
		decoder := json.NewDecoder(bytes.NewReader([]byte(sample)))
		${strict ? 'decoder.DisallowUnknownFields()' : ''}
		if err := decoder.Decode(&value); err != nil {
			return err
		}
	}
	return nil
}
`)
      imports.push(`\t"check/${pkg}"`)
      calls.push(`\tif err := ${pkg}.Check([]string{${samplesOf(c).map((sample) => JSON.stringify(sample)).join(', ')}}); err != nil {\n\t\tfmt.Println(${JSON.stringify(c.name)}, err)\n\t\tfailed = true\n\t}`)
    })
    fs.writeFileSync(`${dir}/main.go`, `package main

import (
	"fmt"
	"os"
${imports.join('\n')}
)

func main() {
	failed := false
${calls.join('\n')}
	if failed {
		os.Exit(1)
	}
}
`)
    const result = spawnSync('go', ['run', '.'], { cwd: dir, encoding: 'utf8', timeout: 170_000 })
    fs.rmSync(dir, { recursive: true, force: true })
    expect(result.error).toBeUndefined()
    expect(result.stdout + result.stderr).toBe('')
    expect(result.status).toBe(0)
  }, 180_000)
})

const pythonVersion = tool('python3', ['-I', '-c', 'import sys; print(sys.version_info[0] * 100 + sys.version_info[1])'])

describe.skipIf(!pythonVersion)('Python output compiles (and runs where the interpreter allows)', () => {
  it('every case, TypedDict and pydantic', () => {
    const dir = tempDir('json-types-py-')
    const jobs: { file: string; flavor: string; samples: string[] }[] = []
    corpus.forEach((c, index) => {
      for (const flavor of ['typeddict', 'pydantic'] as const) {
        const file = `${dir}/c${index}_${flavor}.py`
        fs.writeFileSync(file, generate(c, { target: 'python', python: flavor }))
        jobs.push({ file, flavor, samples: samplesOf(c) })
      }
    })
    fs.writeFileSync(`${dir}/jobs.json`, JSON.stringify(jobs))
    const script = `
import json, sys
jobs = json.load(open(sys.argv[1]))
try:
    import pydantic
except ImportError:
    pydantic = None
for job in jobs:
    source = open(job["file"]).read()
    code = compile(source, job["file"], "exec")
    if job["flavor"] == "typeddict" and sys.version_info >= (3, 11):
        exec(code, {"__name__": "check"})
    if job["flavor"] == "pydantic" and pydantic is not None:
        scope = {"__name__": "check"}
        exec(code, scope)
        for sample in job["samples"]:
            scope["Root"].model_validate_json(sample)
print("ok")
`
    const result = spawnSync('python3', ['-I', '-c', script, `${dir}/jobs.json`], { cwd: dir, encoding: 'utf8', timeout: 60_000 })
    fs.rmSync(dir, { recursive: true, force: true })
    expect(result.stderr).toBe('')
    expect(result.stdout.trim()).toBe('ok')
  }, 90_000)
})

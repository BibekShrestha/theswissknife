import { describe, expect, it } from 'vitest'
import { downloadMeta, exitLabel, outputBytes, pickDisplay } from './output'
import { defaultOptions, type RunResult } from './types'

const run = (over: Partial<RunResult>): RunResult => ({ stdout: '', stderr: '', exitCode: 0, ms: 1, ...over })

describe('JQ-1: what the output pane shows', () => {
  const good = run({ stdout: '"old"\n' })

  it('shows the partial output of a run that failed at runtime, not an older run', () => {
    // `.[] | (1 / .)` on [1, 0]: jq prints 1, then fails on the zero (exit 5).
    const partial = run({ stdout: '1\n', stderr: 'jq: error (at <stdin>:0): 1 and 0 cannot be divided because the divisor is zero', exitCode: 5 })
    const view = pickDisplay(partial, good)
    expect(view.display).toBe(partial)
    expect(view.stale).toBe(false)
  })

  it('falls back to the last good output only when this run printed nothing', () => {
    const compile = run({ stderr: 'jq: error: syntax error', exitCode: 3 })
    expect(pickDisplay(compile, good)).toEqual({ display: good, stale: true })
    const killed = run({ stderr: 'timeout', exitCode: -1, killed: 'timeout' })
    expect(pickDisplay(killed, good)).toEqual({ display: good, stale: true })
  })

  it('shows a successful run as it is', () => {
    const ok = run({ stdout: '1\n' })
    expect(pickDisplay(ok, good)).toEqual({ display: ok, stale: false })
    const empty = run({ exitCode: 4 })
    expect(pickDisplay(empty, good)).toEqual({ display: empty, stale: false })
  })
})

describe('JQ-5: exit chips', () => {
  it('labels an invocation error as such, not as a killed run', () => {
    expect(exitLabel(run({ exitCode: -2, stderr: 'unclosed quote' })).text).toBe('invocation error')
    expect(exitLabel(run({ exitCode: -1, killed: 'timeout' })).text).toBe('killed')
    expect(exitLabel(run({ exitCode: -1, killed: 'stopped' })).text).toBe('stopped')
    expect(exitLabel(run({ exitCode: -1 })).text).toBe('crashed')
    expect(exitLabel(run({ exitCode: 5 }))).toEqual({ text: 'exit 5', cls: 'err' })
    expect(exitLabel(run({ exitCode: 0 }))).toEqual({ text: 'exit 0', cls: 'ok' })
  })
})

describe('JQ-6: output size and download', () => {
  it('counts UTF-8 bytes, not UTF-16 code units', () => {
    expect(outputBytes('"é"\n')).toBe(5)
    expect(outputBytes('"😀"')).toBe(6)
  })

  it('downloads raw output as text', () => {
    expect(downloadMeta(defaultOptions)).toEqual({ name: 'output.json', type: 'application/json' })
    expect(downloadMeta({ ...defaultOptions, outputMode: 'raw' })).toEqual({ name: 'output.txt', type: 'text/plain' })
    expect(downloadMeta({ ...defaultOptions, outputMode: 'join' })).toEqual({ name: 'output.txt', type: 'text/plain' })
    expect(downloadMeta({ ...defaultOptions, extraFlags: '-rc' }).name).toBe('output.txt')
    expect(downloadMeta({ ...defaultOptions, extraFlags: '--raw-output0' }).name).toBe('output.txt')
    expect(downloadMeta({ ...defaultOptions, extraFlags: '--compact-output' }).name).toBe('output.json')
  })
})

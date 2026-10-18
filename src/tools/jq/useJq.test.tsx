/**
 * The run deadline guards against runaway filters. It must not also count the
 * time the wasm takes to download and compile on a slow first visit.
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunResult } from './types'
import { useJq } from './useJq'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class FakeWorker {
  static all: FakeWorker[] = []
  sent: { type: string }[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  terminated = false
  constructor() {
    FakeWorker.all.push(this)
  }
  postMessage(message: { type: string }) {
    this.sent.push(message)
  }
  terminate() {
    this.terminated = true
  }
  reply(data: unknown) {
    this.onmessage?.({ data } as MessageEvent)
  }
}

let root: Root
let api: ReturnType<typeof useJq>
const results: RunResult[] = []

function Probe() {
  api = useJq((r) => results.push(r), 15)
  return null
}

beforeEach(async () => {
  vi.useFakeTimers()
  FakeWorker.all = []
  results.length = 0
  vi.stubGlobal('Worker', FakeWorker)
  root = createRoot(document.createElement('div'))
  await act(async () => root.render(<Probe />))
})

afterEach(() => {
  act(() => root.unmount())
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('JQ-7: the deadline starts when jq is ready', () => {
  it('does not time out a run queued while the wasm is still loading', async () => {
    const worker = FakeWorker.all[0]
    act(() => api.run({ input: '1', query: '.', flags: [] }))
    // A slow first load: 20 s before the wasm is ready, past the 15 s deadline.
    await act(async () => vi.advanceTimersByTime(20_000))
    expect(results).toEqual([])
    expect(worker.terminated).toBe(false)
    expect(worker.sent.filter((m) => m.type === 'run')).toHaveLength(0)

    await act(async () => worker.reply({ type: 'ready', version: 'jq-1.8.2' }))
    expect(worker.sent.filter((m) => m.type === 'run')).toHaveLength(1)
    expect(api.ready).toBe(true)
  })

  it('still kills a run that hangs once jq is ready', async () => {
    const worker = FakeWorker.all[0]
    await act(async () => worker.reply({ type: 'ready', version: 'jq-1.8.2' }))
    act(() => api.run({ input: '1', query: 'repeat(.)', flags: [] }))
    await act(async () => vi.advanceTimersByTime(15_001))
    expect(results).toHaveLength(1)
    expect(results[0].killed).toBe('timeout')
    expect(worker.terminated).toBe(true)
  })
})

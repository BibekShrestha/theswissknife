import { afterEach, describe, expect, it, vi } from 'vitest'
import { runInference } from './engine'
import { createInferRunner, type InferReply, type InferRequest, type WorkerLike } from './runner'
import { defaults } from './testkit'

/** A fake worker that answers only when told to, so the deadline can be driven by fake timers. */
class FakeWorker implements WorkerLike {
  static spawned: FakeWorker[] = []
  onmessage: ((event: MessageEvent<InferReply>) => void) | null = null
  pending: InferRequest[] = []
  terminated = false

  constructor() {
    FakeWorker.spawned.push(this)
  }

  postMessage(request: InferRequest) {
    this.pending.push(request)
  }

  answer() {
    const request = this.pending.shift()!
    this.onmessage?.({ data: { id: request.id, result: runInference(request.text, request.options), elapsedMs: 1 } } as MessageEvent<InferReply>)
  }

  terminate() {
    this.terminated = true
  }
}

afterEach(() => {
  FakeWorker.spawned = []
  vi.useRealTimers()
})

describe('inference runner', () => {
  it('returns the worker’s result and reuses the worker', async () => {
    const runner = createInferRunner(() => new FakeWorker(), 1000)
    const first = runner.run('{"a":1}', defaults)
    FakeWorker.spawned[0].answer()
    expect(await first).toMatchObject({ result: { ok: true } })
    const second = runner.run('{"b":1}', defaults)
    FakeWorker.spawned[0].answer()
    expect(await second).toMatchObject({ result: { ok: true } })
    expect(FakeWorker.spawned).toHaveLength(1)
  })

  it('terminates a worker that misses the deadline and spawns a fresh one next time', async () => {
    vi.useFakeTimers()
    const runner = createInferRunner(() => new FakeWorker(), 1000)
    const stuck = runner.run('{"a":1}', defaults)
    vi.advanceTimersByTime(1000)
    expect(await stuck).toEqual({ stopped: true, timeoutMs: 1000 })
    expect(FakeWorker.spawned[0].terminated).toBe(true)
    const next = runner.run('{"a":1}', defaults)
    expect(FakeWorker.spawned).toHaveLength(2)
    FakeWorker.spawned[1].answer()
    expect(await next).toMatchObject({ result: { ok: true } })
  })

  it('abandons a busy run when a newer one starts', () => {
    const runner = createInferRunner(() => new FakeWorker(), 1000)
    void runner.run('{"a":1}', defaults)
    void runner.run('{"a":2}', defaults)
    expect(FakeWorker.spawned[0].terminated).toBe(true)
    expect(FakeWorker.spawned).toHaveLength(2)
    runner.dispose()
    expect(FakeWorker.spawned[1].terminated).toBe(true)
  })
})

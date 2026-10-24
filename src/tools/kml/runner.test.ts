import { afterEach, describe, expect, it, vi } from 'vitest'
import { kmlToDxf } from './convert'
import { createConvertRunner, type ConvertReply, type ConvertRequest, type Job, type WorkerLike } from './runner'
import { SAMPLE_KML } from './sample'

/** A fake worker that answers only when told to, so the deadline can be driven by fake timers. */
class FakeWorker implements WorkerLike {
  static spawned: FakeWorker[] = []
  onmessage: ((event: MessageEvent<ConvertReply>) => void) | null = null
  pending: ConvertRequest[] = []
  terminated = false

  constructor() {
    FakeWorker.spawned.push(this)
  }

  postMessage(request: ConvertRequest) {
    this.pending.push(request)
  }

  async answer() {
    const request = this.pending.shift()!
    if (request.job.direction !== 'kml-to-dxf') throw new Error('unexpected job')
    const result = await kmlToDxf(request.name, request.bytes, request.job.options)
    this.onmessage?.({ data: { id: request.id, result, elapsedMs: 1 } } as MessageEvent<ConvertReply>)
  }

  terminate() {
    this.terminated = true
  }
}

const bytes = new TextEncoder().encode(SAMPLE_KML)
const job: Job = { direction: 'kml-to-dxf', options: { crs: 'utm-auto', altitude: false, labels: true, folders: true } }

afterEach(() => {
  FakeWorker.spawned = []
  vi.useRealTimers()
})

describe('conversion runner', () => {
  it('returns the worker’s result and reuses the worker', async () => {
    const runner = createConvertRunner(() => new FakeWorker(), 1000)
    const first = runner.run(1, 'a.kml', bytes, job)
    await FakeWorker.spawned[0].answer()
    expect(await first).toMatchObject({ result: { ok: true } })
    const second = runner.run(1, 'a.kml', bytes, job)
    await FakeWorker.spawned[0].answer()
    expect(await second).toMatchObject({ result: { ok: true } })
    expect(FakeWorker.spawned).toHaveLength(1)
  })

  it('terminates a worker that misses the deadline and spawns a fresh one next time', async () => {
    vi.useFakeTimers()
    const runner = createConvertRunner(() => new FakeWorker(), 1000)
    const stuck = runner.run(1, 'a.kml', bytes, job)
    vi.advanceTimersByTime(1000)
    expect(await stuck).toEqual({ stopped: true, timeoutMs: 1000 })
    expect(FakeWorker.spawned[0].terminated).toBe(true)
    void runner.run(1, 'a.kml', bytes, job)
    expect(FakeWorker.spawned).toHaveLength(2)
    runner.dispose()
  })

  it('abandons a busy run when a newer one starts', () => {
    const runner = createConvertRunner(() => new FakeWorker(), 1000)
    void runner.run(1, 'a.kml', bytes, job)
    void runner.run(2, 'b.kml', bytes, job)
    expect(FakeWorker.spawned[0].terminated).toBe(true)
    expect(FakeWorker.spawned).toHaveLength(2)
    runner.dispose()
    expect(FakeWorker.spawned[1].terminated).toBe(true)
  })
})

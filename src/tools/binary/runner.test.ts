import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleDecode } from './decode'
import { createDecodeRunner, type WorkerLike } from './runner'
import type { DecodeRequest, WorkerMessage } from './types'

const request: Omit<DecodeRequest, 'id'> = { bytes: new Uint8Array([8, 0x96, 1]), format: 'auto', options: { packed: false, proto: '', root: '' } }

/** Answers like binary.worker.ts, or never answers when `hang` is set — a decoder stuck on hostile input. */
function fakeWorker(hang = false) {
  const worker: WorkerLike & { terminated: boolean } = {
    onmessage: null,
    terminated: false,
    postMessage(req: DecodeRequest) {
      if (hang) return
      queueMicrotask(() => {
        const data: WorkerMessage = { type: 'result', id: req.id, result: handleDecode(req) }
        worker.onmessage?.({ data } as MessageEvent<WorkerMessage>)
      })
    },
    terminate() {
      worker.terminated = true
    },
  }
  return worker
}

afterEach(() => {
  vi.useRealTimers()
})

describe('decode runner', () => {
  it('returns the worker result and reuses the worker', async () => {
    const spawn = vi.fn(() => fakeWorker())
    const runner = createDecodeRunner(spawn, 1000)
    expect((await runner.run(request)).detection?.format).toBe('protobuf')
    expect((await runner.run({ ...request, bytes: new Uint8Array([0xa0]) })).detection?.format).toBe('cbor')
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('kills a worker that misses the deadline and starts fresh next time', async () => {
    vi.useFakeTimers()
    const hung = fakeWorker(true)
    const spawn = vi.fn<() => WorkerLike>().mockReturnValueOnce(hung).mockImplementation(() => fakeWorker())
    const runner = createDecodeRunner(spawn, 1000)

    const pending = runner.run(request)
    await vi.advanceTimersByTimeAsync(1000)
    const timedOut = await pending
    expect(timedOut.error).toMatch(/Stopped after 1 s/)
    expect(hung.terminated).toBe(true)

    vi.useRealTimers()
    expect((await runner.run(request)).error).toBeNull()
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('abandons a busy worker when a newer request arrives', async () => {
    const hung = fakeWorker(true)
    const spawn = vi.fn<() => WorkerLike>().mockReturnValueOnce(hung).mockImplementation(() => fakeWorker())
    const runner = createDecodeRunner(spawn, 60_000)

    void runner.run(request)
    const latest = await runner.run({ ...request, format: 'cbor' })
    expect(hung.terminated).toBe(true)
    expect(latest.result.format).toBe('cbor')
    runner.dispose()
  })
})

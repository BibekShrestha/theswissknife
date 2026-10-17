import { afterEach, describe, expect, it, vi } from 'vitest'
import { computeDiff } from './compute'
import { createDiffRunner, type WorkerLike } from './runner'
import type { DiffReply, DiffRequest } from './types'

const request: Omit<DiffRequest, 'id'> = { left: 'a\n', right: 'b\n', options: { mode: 'text', ignoreWhitespace: false, ignoreCase: false } }

/** Answers like diff.worker.ts, or never answers when `hang` is set. */
function fakeWorker(hang = false) {
  const worker: WorkerLike & { terminated: boolean } = {
    onmessage: null,
    terminated: false,
    postMessage(req: DiffRequest) {
      if (hang) return
      queueMicrotask(() => {
        const data: DiffReply = { id: req.id, result: computeDiff(req.left, req.right, req.options), elapsedMs: 0 }
        worker.onmessage?.({ data } as MessageEvent<DiffReply>)
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

describe('createDiffRunner', () => {
  it('returns the worker result', async () => {
    const runner = createDiffRunner(() => fakeWorker(), 1000)
    const reply = await runner.run(request)
    expect(reply.result).toMatchObject({ added: 1, removed: 1 })
  })

  it('terminates a worker that misses the deadline and starts a fresh one', async () => {
    vi.useFakeTimers()
    const spawned: ReturnType<typeof fakeWorker>[] = []
    let hang = true
    const runner = createDiffRunner(() => { const w = fakeWorker(hang); spawned.push(w); return w }, 500)
    const pending = runner.run(request)
    vi.advanceTimersByTime(500)
    expect((await pending).result).toEqual({ error: expect.stringMatching(/^Stopped after 0.5 s/) })
    expect(spawned[0].terminated).toBe(true)

    hang = false
    vi.useRealTimers()
    const reply = await runner.run(request)
    expect(spawned).toHaveLength(2)
    expect(reply.result).toMatchObject({ added: 1 })
  })

  it('abandons a busy worker when a newer request arrives', () => {
    const spawned: ReturnType<typeof fakeWorker>[] = []
    const runner = createDiffRunner(() => { const w = fakeWorker(true); spawned.push(w); return w }, 10_000)
    void runner.run(request)
    void runner.run(request)
    expect(spawned[0].terminated).toBe(true)
    expect(spawned).toHaveLength(2)
    runner.dispose()
  })
})

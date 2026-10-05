import { afterEach, describe, expect, it, vi } from 'vitest'
import { evaluateJavascript } from './javascript'
import { createRegexRunner, type WorkerLike } from './runner'
import type { RegexRequest, RegexWorkerMessage } from './types'

const request: Omit<RegexRequest, 'id'> = { engines: ['javascript'], pattern: 'o', flags: 'g', subject: 'foo', operation: 'match', replacement: '' }

/** Answers like regex.worker.ts, or never answers when `hang` is set — a stuck backtrack. */
function fakeWorker(hang = false) {
  const worker: WorkerLike & { terminated: boolean } = {
    onmessage: null,
    terminated: false,
    postMessage(req: RegexRequest) {
      if (hang) return
      queueMicrotask(() => {
        const data: RegexWorkerMessage = { type: 'result', id: req.id, result: evaluateJavascript(req) }
        worker.onmessage?.({ data } as MessageEvent<RegexWorkerMessage>)
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

describe('regex runner', () => {
  it('returns the worker result and reuses the worker', async () => {
    const spawn = vi.fn(() => fakeWorker())
    const runner = createRegexRunner(spawn, 1000)
    expect((await runner.run(request)).matches).toHaveLength(2)
    expect((await runner.run({ ...request, pattern: 'f' })).matches).toHaveLength(1)
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('kills a worker that misses the deadline and starts fresh next time', async () => {
    vi.useFakeTimers()
    const hung = fakeWorker(true)
    const spawn = vi.fn<() => WorkerLike>().mockReturnValueOnce(hung).mockImplementation(() => fakeWorker())
    const runner = createRegexRunner(spawn, 1000)

    const pending = runner.run({ ...request, pattern: '(a+)+b' })
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
    const runner = createRegexRunner(spawn, 60_000)

    void runner.run(request)
    const latest = await runner.run({ ...request, pattern: 'f' })
    expect(hung.terminated).toBe(true)
    expect(latest.matches).toHaveLength(1)
    runner.dispose()
  })
})

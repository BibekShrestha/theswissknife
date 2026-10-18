import { afterEach, describe, expect, it, vi } from 'vitest'
import { findRanges } from './redact'
import { createMatchRunner, type MatchRequest, type MatchWorkerMessage, type WorkerLike } from './runner'

/**
 * Answers like match.worker.ts. With `hangAt`, it reports starting that
 * target and then never answers — a pattern stuck backtracking.
 */
function fakeWorker(hangAt = -1) {
  const worker: WorkerLike & { terminated: boolean } = {
    onmessage: null,
    terminated: false,
    postMessage(req: MatchRequest) {
      const send = (data: MatchWorkerMessage) => queueMicrotask(() => worker.onmessage?.({ data } as MessageEvent<MatchWorkerMessage>))
      if (hangAt >= 0) {
        for (let i = 0; i <= hangAt; i++) send({ type: 'progress', id: req.id, index: i })
        return
      }
      send({ type: 'result', id: req.id, report: findRanges(req.text, req.targets, { caseSensitive: req.caseSensitive }) })
    },
    terminate() {
      worker.terminated = true
    },
  }
  return worker
}

const request: Omit<MatchRequest, 'id'> = { text: 'call Ann or ann', targets: [{ kind: 'literal', value: 'ann' }], caseSensitive: false }

afterEach(() => {
  vi.useRealTimers()
})

describe('redact match runner (RDX-2)', () => {
  it('matches in the worker and reuses it', async () => {
    const spawn = vi.fn(() => fakeWorker())
    const runner = createMatchRunner(spawn, 1000)
    const first = await runner.run(request)
    expect(first.timedOut).toBe(false)
    expect(first.timedOut === false && first.report.counts).toEqual([2])
    await runner.run({ ...request, caseSensitive: true })
    expect(spawn).toHaveBeenCalledTimes(1)
    runner.dispose()
  })

  it('kills a hung worker at the deadline and names the pattern that hung', async () => {
    vi.useFakeTimers()
    const hung = fakeWorker(1)
    const spawn = vi.fn<() => WorkerLike>().mockReturnValueOnce(hung).mockImplementation(() => fakeWorker())
    const runner = createMatchRunner(spawn, 1000)

    const pending = runner.run({ ...request, targets: [{ kind: 'regex', value: 'x' }, { kind: 'regex', value: '(a+)+$' }] })
    await vi.advanceTimersByTimeAsync(1000)
    expect(await pending).toEqual({ timedOut: true, culprit: 1 })
    expect(hung.terminated).toBe(true)

    vi.useRealTimers()
    expect((await runner.run(request)).timedOut).toBe(false)
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('abandons a busy worker when a newer request arrives', async () => {
    const hung = fakeWorker(0)
    const spawn = vi.fn<() => WorkerLike>().mockReturnValueOnce(hung).mockImplementation(() => fakeWorker())
    const runner = createMatchRunner(spawn, 60_000)
    void runner.run(request)
    const latest = await runner.run(request)
    expect(hung.terminated).toBe(true)
    expect(latest.timedOut).toBe(false)
    runner.dispose()
  })
})

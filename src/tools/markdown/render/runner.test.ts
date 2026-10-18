import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderJob, type RenderRequest, type RenderReply } from './job'
import { createRenderRunner, type RenderWorkerLike } from './runner'

const request: Omit<RenderRequest, 'id'> = { source: '# Hi\n\nthere', highlight: true }

/** Answers like render.worker.ts, or never answers when `hang` is set. */
function fakeWorker(hang = false) {
  const worker: RenderWorkerLike & { terminated: boolean, seen: string[] } = {
    onmessage: null,
    onerror: null,
    terminated: false,
    seen: [],
    postMessage(req: RenderRequest) {
      worker.seen.push(req.source)
      if (hang) return
      queueMicrotask(() => worker.onmessage?.({ data: renderJob(req) } as MessageEvent<RenderReply>))
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

describe('render job (MD-2)', () => {
  it('reports a renderer crash instead of throwing', () => {
    const reply = renderJob({ id: 1, source: 'x', highlight: true }, () => { throw new RangeError('Maximum call stack size exceeded') })
    expect(reply).toEqual({ id: 1, ok: false, message: 'Maximum call stack size exceeded' })
  })

  it('survives deeply nested input', () => {
    for (const source of ['>'.repeat(3000) + ' x', '- '.repeat(3000)]) {
      const reply = renderJob({ id: 2, source, highlight: true })
      expect(reply.id).toBe(2)
      if (!reply.ok) expect(reply.message).toMatch(/\S/)
    }
  })

  it('returns the render and the counts', () => {
    const reply = renderJob({ id: 3, ...request })
    expect(reply.ok && reply.result.title).toBe('Hi')
    expect(reply.ok && reply.counts.words).toBe(2)
  })
})

describe('render runner (MD-3)', () => {
  it('returns the worker result and reuses the worker', async () => {
    const spawn = vi.fn(() => fakeWorker())
    const runner = createRenderRunner(spawn, 1000)
    const first = await runner.run(request)
    expect(first?.ok && first.result.title).toBe('Hi')
    expect((await runner.run({ ...request, source: '# Two' }))?.ok).toBe(true)
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('kills a render that misses the deadline and starts fresh next time', async () => {
    vi.useFakeTimers()
    const hung = fakeWorker(true)
    const spawn = vi.fn<() => RenderWorkerLike>().mockReturnValueOnce(hung).mockImplementation(() => fakeWorker())
    const runner = createRenderRunner(spawn, 1000)
    const pending = runner.run({ ...request, source: '['.repeat(40000) })
    await vi.advanceTimersByTimeAsync(1000)
    const outcome = await pending
    expect(outcome).toMatchObject({ ok: false, timedOut: true })
    expect(outcome?.ok === false && outcome.message).toMatch(/took too long/)
    expect(hung.terminated).toBe(true)
    vi.useRealTimers()
    expect((await runner.run(request))?.ok).toBe(true)
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('lets a busy render finish and runs only the latest of the waiting ones', async () => {
    let release: (() => void) | undefined
    const slow = fakeWorker()
    const post = slow.postMessage.bind(slow)
    slow.postMessage = (req) => { if (!release) release = () => post(req); else post(req) }
    const runner = createRenderRunner(() => slow, 60_000)
    const first = runner.run({ ...request, source: 'one' })
    const skipped = runner.run({ ...request, source: 'two' })
    const latest = runner.run({ ...request, source: 'three' })
    expect(await skipped).toBeNull()
    release!()
    expect((await first)?.ok).toBe(true)
    expect((await latest)?.ok).toBe(true)
    expect(slow.seen).toEqual(['one', 'three'])
    expect(slow.terminated).toBe(false)
    runner.dispose()
  })

  it('reports a worker that dies and replaces it', async () => {
    const broken = fakeWorker(true)
    broken.postMessage = () => queueMicrotask(() => broken.onerror?.({ message: 'boom' } as ErrorEvent))
    const spawn = vi.fn<() => RenderWorkerLike>().mockReturnValueOnce(broken).mockImplementation(() => fakeWorker())
    const runner = createRenderRunner(spawn, 1000)
    expect(await runner.run(request)).toMatchObject({ ok: false, timedOut: false })
    expect(broken.terminated).toBe(true)
    expect((await runner.run(request))?.ok).toBe(true)
  })
})

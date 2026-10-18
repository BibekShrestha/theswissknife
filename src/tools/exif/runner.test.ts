import { afterEach, describe, expect, it, vi } from 'vitest'
import { processImage } from './lib/analyze'
import { CAMERA_TIFF, exifSegment, jpeg, tiff } from './lib/testkit'
import type { ExifReply, ExifRequest } from './protocol'
import { createExifRunner, ExifTimeoutError, type WorkerLike } from './runner'

const OPTIONS = { keepOrientation: false, keepIcc: true }
const file = () => jpeg([exifSegment(tiff(CAMERA_TIFF))])

/** Answers like exif.worker.ts; `hang` never answers (a parser stuck in a loop), `crash` fires onerror. */
function fakeWorker(mode: 'ok' | 'hang' | 'crash' = 'ok') {
  const worker: WorkerLike & { terminated: boolean } = {
    onmessage: null,
    onerror: null,
    terminated: false,
    postMessage(req: ExifRequest) {
      if (mode === 'hang') return
      if (mode === 'crash') {
        queueMicrotask(() => worker.onerror?.({} as ErrorEvent))
        return
      }
      void processImage(req.bytes, req.options).then(
        (result) => worker.onmessage?.({ data: { id: req.id, ok: true, result } } as MessageEvent<ExifReply>),
        (error: Error) => worker.onmessage?.({ data: { id: req.id, ok: false, error: error.message } } as MessageEvent<ExifReply>),
      )
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

describe('exif runner', () => {
  it('processes files in order on one worker', async () => {
    const spawn = vi.fn(() => fakeWorker())
    const runner = createExifRunner(spawn, 5000)
    const [a, b] = await Promise.all([runner.process(file(), OPTIONS), runner.process(file(), OPTIONS)])
    expect(a.remaining).toEqual([])
    expect(b.before.blocks[0].kind).toBe('exif')
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('passes parser errors through', async () => {
    const runner = createExifRunner(() => fakeWorker(), 5000)
    await expect(runner.process(new TextEncoder().encode('not an image'), OPTIONS)).rejects.toThrow(/Not a supported image/)
  })

  it('kills a worker that misses the deadline, then carries on with a fresh one', async () => {
    vi.useFakeTimers()
    const workers: ReturnType<typeof fakeWorker>[] = []
    const runner = createExifRunner(() => {
      const w = fakeWorker(workers.length === 0 ? 'hang' : 'ok')
      workers.push(w)
      return w
    }, 1000)
    const stuck = runner.process(file(), OPTIONS)
    const next = runner.process(file(), OPTIONS)
    const caught = stuck.catch((e) => e)
    await vi.advanceTimersByTimeAsync(1001)
    expect(await caught).toBeInstanceOf(ExifTimeoutError)
    expect(workers[0].terminated).toBe(true)
    vi.useRealTimers()
    expect((await next).remaining).toEqual([])
    expect(workers).toHaveLength(2)
  })

  it('reports a crashed worker and replaces it', async () => {
    let n = 0
    const runner = createExifRunner(() => fakeWorker(n++ === 0 ? 'crash' : 'ok'), 5000)
    await expect(runner.process(file(), OPTIONS)).rejects.toThrow(/crashed/)
    expect((await runner.process(file(), OPTIONS)).identical).toBe(true)
  })

  it('rejects everything after dispose', async () => {
    const runner = createExifRunner(() => fakeWorker('hang'), 5000)
    const pending = runner.process(file(), OPTIONS)
    await Promise.resolve()
    runner.dispose()
    await expect(pending).rejects.toThrow(/closed/)
    await expect(runner.process(file(), OPTIONS)).rejects.toThrow(/closed/)
  })
})

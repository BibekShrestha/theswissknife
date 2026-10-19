import { describe, expect, it } from 'vitest'
import { describeError } from './lib/errors'
import { runJob } from './jobs'
import { createPdfRunner, PdfCrashError, PdfTimeoutError, type Timers, type WorkerLike } from './runner'
import type { PdfReply, PdfRequest } from './protocol'
import { objectStreamBomb } from './test/bomb'
import { makePdf, pageTexts } from './test/helpers'

const MiB = 1024 * 1024

/**
 * A clock that only moves when told to, so no test depends on how fast the
 * machine is: deadlines are measured in work done, not wall-clock time.
 */
function virtualClock() {
  let now = 0
  let nextHandle = 0
  const due = new Map<number, { at: number; callback: () => void }>()
  const timers: Timers = {
    set: (callback, ms) => {
      due.set(++nextHandle, { at: now + ms, callback })
      return nextHandle
    },
    clear: (handle) => void due.delete(handle as number),
  }
  const advance = (ms: number) => {
    now += ms
    for (const [handle, t] of [...due].sort((a, b) => a[1].at - b[1].at)) {
      if (t.at > now || !due.has(handle)) continue
      due.delete(handle)
      t.callback()
    }
  }
  return { timers, advance, pending: () => due.size }
}

class Terminated extends Error {}

/**
 * Stands in for pdf.worker.ts by running the real jobs in-process. Every
 * inflated chunk advances the virtual clock by one millisecond per MiB, and
 * once the runner terminates the "worker" its next chunk throws — the way a
 * real terminated worker simply stops.
 */
function inProcessWorkers(clock: ReturnType<typeof virtualClock>, maxInflatedBytes = Infinity) {
  const spawned: { terminated: boolean; inflated: number; transfers: number }[] = []
  const spawn = (): WorkerLike => {
    const state = { terminated: false, inflated: 0, transfers: 0 }
    spawned.push(state)
    const w: WorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage(request: PdfRequest, transfer: Transferable[]) {
        state.transfers += transfer.length
        const reply = (data: PdfReply) => {
          if (!state.terminated) w.onmessage?.({ data } as MessageEvent<PdfReply>)
        }
        const work = {
          maxInflatedBytes,
          onInflate: (bytes: number) => {
            if (state.terminated) throw new Terminated()
            state.inflated += bytes
            clock.advance(bytes / MiB)
            if (state.terminated) throw new Terminated()
          },
        }
        runJob(request.job, request.args as never, { work, onProgress: (value) => reply({ id: request.id, type: 'progress', value }) }).then(
          (result) => reply({ id: request.id, type: 'done', result }),
          (error) => reply({ id: request.id, type: 'error', message: describeError(error) }),
        )
      },
      terminate() {
        state.terminated = true
      },
    }
    return w
  }
  return { spawn, spawned }
}

describe('the PDF runner terminates a job that goes quiet', () => {
  it('kills a decompression bomb mid-inflation when its deadline passes, then carries on with a fresh worker', async () => {
    const clock = virtualClock()
    // the inflate budget is switched off: only the deadline stands between the bomb and the tab
    const { spawn, spawned } = inProcessWorkers(clock)
    const runner = createPdfRunner(spawn, { stallMs: 8, timers: clock.timers })
    const bomb = await objectStreamBomb(64 * MiB)

    const error = await runner.run('compress', { bytes: bomb }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PdfTimeoutError)
    expect(describeError(error)).toMatch(/^Compress PDF stopped: the PDF worker made no progress for 8 ms, so it was shut down/)
    expect(spawned[0].terminated).toBe(true)
    // eight virtual milliseconds is eight MiB of the 64 MiB the bomb claims
    expect(spawned[0].inflated).toBeGreaterThanOrEqual(8 * MiB)
    expect(spawned[0].inflated).toBeLessThan(9 * MiB)

    const out = await runner.run('rotate', { bytes: await makePdf(2), rotation: 90 })
    expect(spawned).toHaveLength(2)
    expect(spawned[1].terminated).toBe(false)
    expect(await pageTexts(out)).toEqual(['Page 1', 'Page 2'])
    expect(clock.pending()).toBe(0)
  })

  it('names the operation in the message', async () => {
    const clock = virtualClock()
    const { spawn } = inProcessWorkers(clock)
    const runner = createPdfRunner(spawn, { stallMs: 4, timers: clock.timers })
    const bomb = await objectStreamBomb(32 * MiB)
    await expect(runner.run('remove-metadata', { bytes: bomb, options: { attachments: false, javascript: false } })).rejects.toThrow(/^Remove Metadata stopped/)
    await expect(runner.run('merge', { inputs: [{ name: 'a.pdf', bytes: bomb }, { name: 'b.pdf', bytes: bomb }] })).rejects.toThrow(/^Merge PDF stopped/)
  })

  it('stops a bomb with the budget alone when the budget is on — no deadline needed', async () => {
    const clock = virtualClock()
    const { spawn, spawned } = inProcessWorkers(clock, 2 * MiB)
    const runner = createPdfRunner(spawn, { stallMs: 1000, timers: clock.timers })
    await expect(runner.run('compress', { bytes: await objectStreamBomb(64 * MiB) })).rejects.toThrow(/decompression bomb/)
    expect(spawned[0].terminated).toBe(false) // the worker reported the error itself and stays usable
    expect(spawned[0].inflated).toBeLessThan(3 * MiB)
  })
})

/** A worker the test answers by hand. */
function scriptedWorkers() {
  const workers: (WorkerLike & { requests: PdfRequest[]; transfers: Transferable[][]; terminated: boolean; reply(data: PdfReply): void })[] = []
  const spawn = () => {
    const w = {
      onmessage: null as WorkerLike['onmessage'],
      onerror: null as WorkerLike['onerror'],
      requests: [] as PdfRequest[],
      transfers: [] as Transferable[][],
      terminated: false,
      postMessage(request: PdfRequest, transfer: Transferable[]) {
        this.requests.push(request)
        this.transfers.push(transfer)
      },
      terminate() {
        this.terminated = true
      },
      reply(data: PdfReply) {
        this.onmessage?.({ data } as MessageEvent<PdfReply>)
      },
    }
    workers.push(w)
    return w
  }
  return { spawn, workers }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the PDF runner', () => {
  it('restarts the deadline on every progress report, so a long healthy job finishes', async () => {
    const clock = virtualClock()
    const { spawn, workers } = scriptedWorkers()
    const runner = createPdfRunner(spawn, { stallMs: 100, timers: clock.timers })
    const seen: number[] = []
    const result = runner.run('merge', { inputs: [] }, { onProgress: (n) => seen.push(n) })
    await flush()
    const [w] = workers
    const { id } = w.requests[0]
    for (let i = 1; i <= 10; i++) {
      clock.advance(90) // 900 ms in all, nine times the deadline, but never 100 ms quiet
      w.reply({ id, type: 'progress', value: i })
    }
    w.reply({ id, type: 'progress' }) // a bare step restarts it too, without a value for the screen
    clock.advance(90)
    w.reply({ id, type: 'done', result: { bytes: new Uint8Array([1]), notes: [] } })
    await expect(result).resolves.toEqual({ bytes: new Uint8Array([1]), notes: [] })
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(w.terminated).toBe(false)
  })

  it('times out a job that reported progress and then went quiet', async () => {
    const clock = virtualClock()
    const { spawn, workers } = scriptedWorkers()
    const runner = createPdfRunner(spawn, { stallMs: 100, timers: clock.timers })
    const result = runner.run('watermark', { bytes: new Uint8Array(4), options: { text: 'x', opacity: 1, position: 'center' } })
    await flush()
    workers[0].reply({ id: workers[0].requests[0].id, type: 'progress' })
    clock.advance(99)
    clock.advance(1)
    await expect(result).rejects.toThrow(/^Watermark stopped/)
    expect(workers[0].terminated).toBe(true)
  })

  it('transfers the input buffers instead of copying them', async () => {
    const { spawn, workers } = scriptedWorkers()
    const runner = createPdfRunner(spawn)
    const a = new Uint8Array([1, 2, 3])
    const b = new Uint8Array([4, 5])
    const closed = runner.run('merge', { inputs: [{ name: 'a', bytes: a }, { name: 'b', bytes: b }] }).catch((e: Error) => e.message)
    await flush()
    expect(workers[0].transfers[0]).toHaveLength(2)
    expect(workers[0].transfers[0]).toEqual(expect.arrayContaining([a.buffer, b.buffer]))
    runner.dispose()
    expect(await closed).toBe('The PDF worker was closed.')
  })

  it('runs jobs one at a time, in order', async () => {
    const { spawn, workers } = scriptedWorkers()
    const runner = createPdfRunner(spawn)
    const first = runner.run('compress', { bytes: new Uint8Array(1) })
    const second = runner.run('compress', { bytes: new Uint8Array(1) })
    await flush()
    expect(workers[0].requests).toHaveLength(1)
    workers[0].reply({ id: workers[0].requests[0].id, type: 'error', message: 'This file is not a PDF.' })
    await expect(first).rejects.toThrow('This file is not a PDF.')
    await flush()
    expect(workers[0].requests).toHaveLength(2)
    workers[0].reply({ id: workers[0].requests[1].id, type: 'done', result: new Uint8Array([9]) })
    await expect(second).resolves.toEqual(new Uint8Array([9]))
  })

  it('reports a crash by name and spawns a new worker for the next job', async () => {
    const { spawn, workers } = scriptedWorkers()
    const runner = createPdfRunner(spawn)
    const crashed = runner.run('split', { bytes: new Uint8Array(1), mode: { kind: 'every', pages: 1 } })
    await flush()
    workers[0].onerror?.({ preventDefault() {} } as ErrorEvent)
    const error = await crashed.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PdfCrashError)
    expect(describeError(error)).toMatch(/^Split PDF failed: the PDF worker crashed/)
    expect(workers[0].terminated).toBe(true)
    const next = runner.run('compress', { bytes: new Uint8Array(1) }).catch(() => 'closed')
    await flush()
    expect(workers).toHaveLength(2)
    void next
    runner.dispose()
  })
})

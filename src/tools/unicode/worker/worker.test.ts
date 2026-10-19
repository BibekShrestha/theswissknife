import { afterEach, describe, expect, it, vi } from 'vitest'
import * as names from '../names/names'
import { createJob, type InspectReply, type InspectRequest } from './job'
import { createInspectRunner, type InspectWorkerLike } from './runner'
// @ts-expect-error — plain .mjs helper
import { readText } from '../../../../scripts/read-text.mjs'

const request: Omit<InspectRequest, 'id'> = { input: 'a\\u200Bb', escapes: true, page: 0, view: { kind: 'chars' } }

describe('inspect job', () => {
  it('decodes escapes, names occurrences and reports the table version', async () => {
    const run = createJob(async () => names)
    const reply = await run({ id: 1, ...request })
    expect(reply.ok).toBe(true)
    if (!reply.ok) return
    expect(reply.result.decoded).toEqual({ decoded: 1, invalid: 0 })
    expect(reply.result.names).toEqual({ status: 'ok', version: '16.0.0' })
    const invisible = reply.result.findings.find((f) => f.kind === 'invisible')!
    expect(invisible.labels).toEqual(['U+200B ZWSP · ZERO WIDTH SPACE'])
    expect(reply.result.page.graphemes[1].cps[0].name).toBe('ZERO WIDTH SPACE')
  })

  it('still inspects when the names table cannot load (offline, never cached)', async () => {
    const load = vi.fn(async () => {
      throw new Error('Failed to fetch dynamically imported module')
    })
    const run = createJob(load)
    const reply = await run({ id: 2, ...request })
    expect(reply.ok && reply.result.names).toEqual({ status: 'unavailable', version: null })
    expect(reply.ok && reply.result.page.graphemes[1].cps[0]).toMatchObject({ name: null, gc: 'Cf' })
    await run({ id: 3, ...request })
    expect(load).toHaveBeenCalledTimes(2) // tries again next time
  })

  it('builds the requested view only', async () => {
    const run = createJob(async () => names)
    const chars = await run({ id: 4, ...request })
    expect(chars.ok && chars.result.normalize).toBeUndefined()
    const nfkc = await run({ id: 5, ...request, input: 'ﬁ', escapes: false, view: { kind: 'normalize', form: 'NFKC' } })
    expect(nfkc.ok && nfkc.result.normalize?.output).toBe('fi')
    const clean = await run({ id: 6, ...request, view: { kind: 'clean', options: { keepEmoji: true, plainSpaces: true } } })
    expect(clean.ok && clean.result.clean?.stripped).toBe('ab')
  })
})

/** Answers like unicode.worker.ts, or never answers when `hang` is set. */
function fakeWorker(hang = false) {
  const run = createJob(async () => names)
  const worker: InspectWorkerLike & { terminated: boolean } = {
    onmessage: null,
    onerror: null,
    terminated: false,
    postMessage(req: InspectRequest) {
      if (hang) return
      void run(req).then((data) => worker.onmessage?.({ data } as MessageEvent<InspectReply>))
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

describe('inspect runner', () => {
  it('returns results and reuses the worker', async () => {
    const spawn = vi.fn(() => fakeWorker())
    const runner = createInspectRunner(spawn, 5000)
    expect((await runner.run(request))?.ok).toBe(true)
    expect((await runner.run({ ...request, page: 1 }))?.ok).toBe(true)
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('kills a worker that passes the deadline and starts a fresh one', async () => {
    vi.useFakeTimers()
    const workers: ReturnType<typeof fakeWorker>[] = []
    const runner = createInspectRunner(() => {
      const w = fakeWorker(workers.length === 0)
      workers.push(w)
      return w
    }, 1000)
    const pending = runner.run(request)
    vi.advanceTimersByTime(1000)
    const outcome = await pending
    expect(outcome).toMatchObject({ ok: false, timedOut: true })
    expect(workers[0].terminated).toBe(true)
    vi.useRealTimers()
    expect((await runner.run(request))?.ok).toBe(true)
    expect(workers.length).toBe(2)
  })

  it('runs only the latest of the requests that queued behind a running one', async () => {
    const runner = createInspectRunner(() => fakeWorker(), 5000)
    const first = runner.run({ ...request, input: 'one' })
    const second = runner.run({ ...request, input: 'two' })
    const third = runner.run({ ...request, input: 'three', escapes: false })
    expect(await second).toBeNull()
    expect((await first)?.ok).toBe(true)
    const last = await third
    expect(last?.ok && last.result.stats.codeUnits).toBe(5)
  })
})

describe('the names table stays lazy', () => {
  const staticImport = (path: string) => new RegExp(`^import[^\\n]*from ['"][^'"]*${path}['"]`, 'm')
  it('is reached only through import() inside the worker', () => {
    const files = ['src/tools/unicode/index.tsx', 'src/tools/unicode/worker/unicode.worker.ts', 'src/tools/unicode/worker/job.ts', 'src/tools/unicode/lib/views.ts', 'src/tools/unicode/lib/analyze.ts']
    for (const file of files) {
      const source: string = readText(file)
      expect(source, file).not.toMatch(staticImport('names/names'))
      expect(source, file).not.toMatch(staticImport('names/table'))
    }
    expect(readText('src/tools/unicode/worker/unicode.worker.ts')).toContain("import('../names/names')")
  })
})

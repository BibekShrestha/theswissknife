import { loadJq, type Jq } from 'jq-wasm'
import wasmUrl from 'jq-wasm/jq.wasm?url'
import type { RunRequest, WorkerToMain } from './types'

const post = (m: WorkerToMain) => (postMessage as (msg: unknown) => void)(m)

let jqPromise: Promise<Jq> | null = null
function getJq(): Promise<Jq> {
  jqPromise ??= loadJq({ wasmURL: new URL(wasmUrl, self.location.href).href })
  return jqPromise
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { type: 'init' } | RunRequest
  if (msg.type === 'init') {
    try {
      const jq = await getJq()
      post({ type: 'ready', version: jq.version })
    } catch (err) {
      post({ type: 'fatal', message: String(err) })
    }
    return
  }
  if (msg.type === 'run') {
    try {
      const jq = await getJq()
      const t0 = performance.now()
      const res = jq.raw(msg.input, msg.query, msg.flags)
      post({
        type: 'result',
        id: msg.id,
        stdout: res.stdout,
        stderr: res.stderr,
        exitCode: res.exitCode,
        ms: performance.now() - t0,
      })
    } catch (err) {
      // A crashed instance is permanently broken (every later run throws
      // "memory access out of bounds") — drop it so the next run reloads
      // the wasm from HTTP cache.
      jqPromise = null
      const raw = err instanceof Error ? err.message : String(err)
      const memoryCrash = /memory access|aborted|unreachable|stack overflow/i.test(raw)
      post({
        type: 'result',
        id: msg.id,
        stdout: '',
        stderr: memoryCrash
          ? `The jq engine crashed (${raw}) and was reloaded. This can happen when a single argument nears 1 MB — put large data in the input pane instead.`
          : raw,
        exitCode: -1,
        ms: 0,
      })
    }
  }
}

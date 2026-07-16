import { useCallback, useEffect, useRef, useState } from 'react'
import type { RunResult, WorkerToMain } from './types'

export interface RunPayload {
  input: string
  query: string
  flags: string[]
}

const TIMEOUT_MS = 15_000

/**
 * Manages the jq worker: serial execution, latest-wins queueing, and a
 * hard kill (terminate + respawn) for runaway filters.
 */
export function useJq(onResult: (r: RunResult) => void) {
  const [ready, setReady] = useState(false)
  const [version, setVersion] = useState<string | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const workerRef = useRef<Worker | null>(null)
  const idRef = useRef(0)
  const busyRef = useRef(false)
  const queuedRef = useRef<RunPayload | null>(null)
  const timerRef = useRef<number | undefined>(undefined)
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult

  const pump = useCallback(() => {
    const q = queuedRef.current
    if (q && !busyRef.current && workerRef.current) {
      queuedRef.current = null
      postRun(q)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function postRun(p: RunPayload) {
    const w = workerRef.current
    if (!w) return
    busyRef.current = true
    setRunning(true)
    const id = ++idRef.current
    w.postMessage({ type: 'run', id, ...p })
    clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => kill('timeout'), TIMEOUT_MS)
  }

  const spawn = useCallback(() => {
    const w = new Worker(new URL('./jq.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent) => {
      const m = e.data as WorkerToMain
      if (m.type === 'ready') {
        setReady(true)
        setVersion(m.version)
        pump()
      } else if (m.type === 'fatal') {
        setFatal(m.message)
      } else if (m.type === 'result') {
        clearTimeout(timerRef.current)
        busyRef.current = false
        if (m.id === idRef.current) {
          setRunning(false)
          onResultRef.current({ stdout: m.stdout, stderr: m.stderr, exitCode: m.exitCode, ms: m.ms })
        }
        pump()
      }
    }
    w.postMessage({ type: 'init' })
    workerRef.current = w
  }, [pump])

  function kill(reason: 'timeout' | 'stopped') {
    clearTimeout(timerRef.current)
    workerRef.current?.terminate()
    workerRef.current = null
    busyRef.current = false
    setRunning(false)
    onResultRef.current({
      stdout: '',
      stderr:
        reason === 'timeout'
          ? `jq did not finish within ${TIMEOUT_MS / 1000}s and was terminated (infinite loop?)`
          : 'Run stopped.',
      exitCode: -1,
      ms: reason === 'timeout' ? TIMEOUT_MS : 0,
      killed: reason,
    })
    spawn()
  }

  useEffect(() => {
    spawn()
    return () => {
      clearTimeout(timerRef.current)
      workerRef.current?.terminate()
    }
  }, [spawn])

  const run = useCallback((p: RunPayload) => {
    if (busyRef.current || !workerRef.current) {
      queuedRef.current = p // latest wins
    } else {
      postRun(p)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stop = useCallback(() => {
    queuedRef.current = null
    if (busyRef.current) kill('stopped')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { ready, version, fatal, running, run, stop }
}

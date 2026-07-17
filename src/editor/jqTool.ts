import type { WorkerToMain } from '../types'

/**
 * Promise API over a second instance of the jq worker, dedicated to tooling
 * runs (builtins list, input path indexing). Kept separate from the run
 * worker so tooling never queues behind — or gets killed with — user runs.
 */

interface ToolResult {
  stdout: string
  stderr: string
  exitCode: number
}

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (r: ToolResult) => void; timer: number }>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../jq.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as WorkerToMain
      if (m.type !== 'result') return
      const p = pending.get(m.id)
      if (!p) return
      clearTimeout(p.timer)
      pending.delete(m.id)
      p.resolve({ stdout: m.stdout, stderr: m.stderr, exitCode: m.exitCode })
    }
  }
  return worker
}

export function toolRun(input: string, query: string, flags: string[], timeoutMs = 5000): Promise<ToolResult> {
  const w = getWorker()
  const id = ++seq
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      pending.delete(id)
      // a stuck tooling run gets its instance discarded, like the run worker
      worker?.terminate()
      worker = null
      resolve({ stdout: '', stderr: 'tooling run timed out', exitCode: -1 })
    }, timeoutMs)
    pending.set(id, { resolve, timer })
    w.postMessage({ type: 'run', id, input, query, flags })
  })
}

/** Full builtin list from the engine itself (["length/0", "map/1", …]). */
export async function fetchBuiltins(): Promise<string[]> {
  const res = await toolRun('null', 'builtins', ['-n', '-c'])
  if (res.exitCode !== 0) return []
  return parseBuiltins(res.stdout)
}

export function parseBuiltins(stdout: string): string[] {
  try {
    const raw = JSON.parse(stdout) as string[]
    const names = new Set<string>()
    for (const entry of raw) {
      const name = entry.split('/')[0]
      if (/^[a-z_]\w*$/i.test(name)) names.add(name)
    }
    return [...names].sort()
  } catch {
    return []
  }
}

const INDEX_QUERY =
  '[limit(20000; inputs | paths)] | map(map(if type == "number" then "[]" else tostring end)) | unique'

const MAX_INDEXABLE_BYTES = 2 * 1024 * 1024

/**
 * Build the paths index for the current input, honoring the same input
 * flags the real run uses (-R yields no object keys; -n reads nothing).
 */
export async function fetchPathsIndex(
  input: string,
  flags: { rawInput: boolean; slurp: boolean; nullInput: boolean },
): Promise<string[][] | null> {
  if (input.length > MAX_INDEXABLE_BYTES) return null
  const argv = ['-n', '-c']
  if (flags.rawInput) argv.push('-R')
  if (flags.slurp) argv.push('-s')
  const res = await toolRun(flags.nullInput ? '' : input, INDEX_QUERY, argv)
  if (res.exitCode !== 0) return null
  try {
    return JSON.parse(res.stdout) as string[][]
  } catch {
    return null
  }
}

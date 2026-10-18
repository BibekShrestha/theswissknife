/** What the output pane shows for a run, kept pure so it can be tested. */

import { tokenizeFlags } from './flags'
import type { JqOptions, RunResult } from './types'

/** Exit code the app uses for a run it refused to start (bad extra flags, oversized args). */
export const INVOCATION_ERROR = -2

// Exit 0 is success; 1 and 4 are -e's semantic codes (null/false or no
// output) — the run itself evaluated fine, so its output is current.
export const isSuccess = (r: RunResult) => r.exitCode === 0 || r.exitCode === 1 || r.exitCode === 4

export function exitLabel(r: RunResult): { text: string; cls: 'ok' | 'warn' | 'err' } {
  const code = r.exitCode
  if (code === 0) return { text: 'exit 0', cls: 'ok' }
  if (code === 1 || code === 4) return { text: `exit ${code}`, cls: 'warn' }
  if (code === INVOCATION_ERROR) return { text: 'invocation error', cls: 'err' }
  if (code < 0) return { text: r.killed === 'stopped' ? 'stopped' : r.killed ? 'killed' : 'crashed', cls: 'err' }
  return { text: `exit ${code}`, cls: 'err' }
}

/**
 * The current run whenever it printed anything — a runtime error (exit 5)
 * after some output leaves that output standing, exactly as in a terminal.
 * Only a run that failed before printing a thing (compile error, timeout)
 * falls back to the last successful output, marked stale.
 */
export function pickDisplay(
  current: RunResult | null,
  lastGood: RunResult | null,
): { display: RunResult | null; stale: boolean } {
  if (!current) return { display: lastGood, stale: false }
  if (isSuccess(current) || current.stdout !== '') return { display: current, stale: false }
  return lastGood ? { display: lastGood, stale: true } : { display: current, stale: false }
}

export const outputBytes = (text: string) => new TextEncoder().encode(text).length

const RAW_LONG = new Set(['--raw-output', '--join-output', '--raw-output0'])

/** -r / -j (from the options or typed as extra flags) print text, not JSON. */
export function isRawOutput(options: JqOptions): boolean {
  if (options.outputMode !== 'json') return true
  const extra = tokenizeFlags(options.extraFlags)
  if (!Array.isArray(extra)) return false
  return extra.some((flag) => RAW_LONG.has(flag) || (/^-[a-zA-Z]+$/.test(flag) && /[rj]/.test(flag)))
}

export function downloadMeta(options: JqOptions): { name: string; type: string } {
  return isRawOutput(options)
    ? { name: 'output.txt', type: 'text/plain' }
    : { name: 'output.json', type: 'application/json' }
}

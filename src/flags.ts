import type { JqOptions } from './types'

export interface Invocation {
  query: string
  flags: string[]
  error?: string
}

// jq variable used to smuggle positional args into $ARGS.positional.
// Real --args/--jsonargs can't be used here: the wasm wrapper appends the
// query and /dev/stdin after the flags, and --args would swallow both.
const POS_VAR = '__jqplay_positional'

// A single argv token of ~1 MB crashes the wasm jq (emscripten stack limit,
// verified empirically: 1000 KB works, 1024 KB aborts). Stay well clear.
const MAX_ARG_BYTES = 512 * 1024

const byteLength = (s: string) => new TextEncoder().encode(s).length

const kb = (n: number) => `${Math.round(n / 1024)} KB`

/** Shell-like tokenizer for the free-form extra flags field. */
export function tokenizeFlags(line: string): string[] | { error: string } {
  const out: string[] = []
  let cur = ''
  let started = false
  let quote: '"' | "'" | null = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote === "'") {
      if (ch === "'") quote = null
      else cur += ch
      continue
    }
    if (quote === '"') {
      if (ch === '\\' && i + 1 < line.length) cur += line[++i]
      else if (ch === '"') quote = null
      else cur += ch
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      started = true
      continue
    }
    if (/\s/.test(ch)) {
      if (cur || started) {
        out.push(cur)
        cur = ''
        started = false
      }
      continue
    }
    if (ch === '\\' && i + 1 < line.length) {
      cur += line[++i]
      continue
    }
    cur += ch
  }
  if (quote) return { error: 'Unclosed quote in extra flags' }
  if (cur || started) out.push(cur)
  return out
}

function coreFlags(o: JqOptions): string[] {
  const flags: string[] = []
  if (o.nullInput) flags.push('-n')
  if (o.rawInput) flags.push('-R')
  if (o.slurp) flags.push('-s')
  if (o.seq) flags.push('--seq')
  if (o.stream) flags.push('--stream')
  if (o.outputMode === 'raw') flags.push('-r')
  else if (o.outputMode === 'join') flags.push('-j')
  if (o.compact) flags.push('-c')
  if (o.indent === 'tab') flags.push('--tab')
  else if (o.indent !== 2) flags.push('--indent', String(o.indent))
  if (o.sortKeys) flags.push('-S')
  if (o.asciiOutput) flags.push('-a')
  if (o.exitStatus) flags.push('-e')
  for (const a of o.namedArgs) {
    if (!a.name.trim()) continue
    flags.push(a.kind === 'arg' ? '--arg' : '--argjson', a.name.trim(), a.value)
  }
  return flags
}

/** Build the (query, flags) pair actually sent to the wasm jq. */
export function buildInvocation(filter: string, o: JqOptions): Invocation {
  for (const a of o.namedArgs) {
    const name = a.name.trim()
    if (name && byteLength(a.value) > MAX_ARG_BYTES) {
      return {
        query: filter,
        flags: [],
        error: `$${name} is ${kb(byteLength(a.value))} — variable values over ${kb(MAX_ARG_BYTES)} crash the WebAssembly jq. Put large data in the input pane instead.`,
      }
    }
  }

  const flags = coreFlags(o)
  let query = filter

  if (o.positionalArgs.length > 0) {
    const values: unknown[] = []
    for (const p of o.positionalArgs) {
      if (p.kind === 'json') {
        try {
          values.push(JSON.parse(p.value))
        } catch {
          return { query, flags, error: `Positional argument is not valid JSON: ${p.value || '(empty)'}` }
        }
      } else {
        values.push(p.value)
      }
    }
    const blob = JSON.stringify(values)
    if (byteLength(blob) > MAX_ARG_BYTES) {
      return {
        query,
        flags,
        error: `Positional arguments total ${kb(byteLength(blob))} — over ${kb(MAX_ARG_BYTES)} they crash the WebAssembly jq. Put large data in the input pane instead.`,
      }
    }
    flags.push('--argjson', POS_VAR, blob)
    // Rebind $ARGS so $ARGS.positional behaves exactly like --args would.
    // Kept on one line so the user's filter line numbers are preserved.
    query = `($ARGS | .positional = $${POS_VAR} | .named |= del(.${POS_VAR})) as $ARGS | (${filter}\n)`
  }

  const extra = tokenizeFlags(o.extraFlags)
  if ('error' in extra) return { query, flags, error: extra.error }
  for (const tok of extra) {
    if (byteLength(tok) > MAX_ARG_BYTES) {
      return {
        query,
        flags,
        error: `An extra-flags token is ${kb(byteLength(tok))} — over ${kb(MAX_ARG_BYTES)} it crashes the WebAssembly jq. Put large data in the input pane instead.`,
      }
    }
  }
  flags.push(...extra)

  return { query, flags }
}

function shellQuote(s: string): string {
  if (s === '') return "''"
  if (/^[A-Za-z0-9_\-./:=@%+,]+$/.test(s)) return s
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

/** Equivalent terminal command, for copy/paste. */
export function buildCliCommand(filter: string, o: JqOptions): string {
  const parts = ['jq', ...coreFlags(o).map(shellQuote)]
  const extra = tokenizeFlags(o.extraFlags)
  if (Array.isArray(extra)) parts.push(...extra.map(shellQuote))

  const pos = o.positionalArgs
  if (pos.length > 0) {
    // --jsonargs if any JSON-typed value is present (strings get JSON-encoded)
    const allStrings = pos.every((p) => p.kind === 'string')
    parts.push(allStrings ? '--args' : '--jsonargs')
    parts.push(shellQuote(filter))
    for (const p of pos) {
      const v = p.kind === 'string' && !allStrings ? JSON.stringify(p.value) : p.value
      parts.push(shellQuote(v))
    }
  } else {
    parts.push(shellQuote(filter))
  }
  return parts.join(' ')
}

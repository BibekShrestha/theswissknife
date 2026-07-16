export type OutputMode = 'json' | 'raw' | 'join'
export type Indent = 2 | 4 | 8 | 'tab'

export interface NamedArg {
  kind: 'arg' | 'argjson'
  name: string
  value: string
}

export interface PositionalArg {
  kind: 'string' | 'json'
  value: string
}

export interface JqOptions {
  // input
  nullInput: boolean // -n
  rawInput: boolean // -R
  slurp: boolean // -s
  seq: boolean // --seq (applies to input AND output)
  stream: boolean // --stream
  // output
  outputMode: OutputMode // (default) | -r | -j
  compact: boolean // -c
  indent: Indent // --indent n / --tab
  sortKeys: boolean // -S
  asciiOutput: boolean // -a
  // behavior
  exitStatus: boolean // -e
  // arguments
  namedArgs: NamedArg[]
  positionalArgs: PositionalArg[]
  extraFlags: string
}

export const defaultOptions: JqOptions = {
  nullInput: false,
  rawInput: false,
  slurp: false,
  seq: false,
  stream: false,
  outputMode: 'json',
  compact: false,
  indent: 2,
  sortKeys: false,
  asciiOutput: false,
  exitStatus: false,
  namedArgs: [],
  positionalArgs: [],
  extraFlags: '',
}

export interface RunResult {
  stdout: string
  stderr: string
  exitCode: number
  ms: number
  killed?: 'timeout' | 'stopped'
}

// worker protocol
export interface RunRequest {
  type: 'run'
  id: number
  input: string
  query: string
  flags: string[]
}

export type WorkerToMain =
  | { type: 'ready'; version: string }
  | { type: 'fatal'; message: string }
  | { type: 'result'; id: number; stdout: string; stderr: string; exitCode: number; ms: number }

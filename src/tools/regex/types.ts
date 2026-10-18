/** Only JavaScript ships today; pcre2/ holds the scripted build for the second engine. */
export type RegexEngine = 'javascript' | 'pcre2'
export type RegexOperation = 'match' | 'replace'

export interface CaptureSpan {
  index: number
  name?: string
  text: string | null
  start: number | null
  end: number | null
}

export interface MatchSpan {
  start: number
  end: number
  text: string
  captures: CaptureSpan[]
}

export interface RegexRequest {
  id: number
  kind?: 'match'
  engines: RegexEngine[]
  pattern: string
  flags: string
  subject: string
  operation: RegexOperation
  replacement: string
}

export interface RegexResult {
  engine: RegexEngine
  version: string
  matches: MatchSpan[]
  replacement: string | null
  elapsedMs: number
  error: string | null
  /** More matches exist than MAX_MATCHES. */
  truncated: boolean
}

/** One line of the Tests tab. */
export interface TestCase {
  text: string
  expect: 'match' | 'no-match'
  /** The whole line must match, not just part of it. */
  full: boolean
}

export interface TestCaseResult {
  pass: boolean
  /** Whether the pattern matched as the case asks (anywhere, or the whole line). */
  matched: boolean
  /** The first match anywhere in the line, if any. */
  match: { start: number; end: number; text: string } | null
}

export interface TestsRequest {
  id: number
  kind: 'tests'
  pattern: string
  flags: string
  cases: TestCase[]
}

export interface TestsResult {
  results: TestCaseResult[]
  elapsedMs: number
  error: string | null
}

export type RegexWorkerMessage =
  | { type: 'result'; id: number; result: RegexResult }
  | { type: 'tests'; id: number; result: TestsResult }

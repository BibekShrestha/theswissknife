export type RegexEngine = 'javascript' | 'pcre2'
export type RegexMode = RegexEngine | 'compare'
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
  truncated: boolean
}

export type RegexWorkerMessage =
  | { type: 'ready' }
  | { type: 'started'; id: number; engine: RegexEngine }
  | { type: 'result'; id: number; result: RegexResult }

import type { DiffError, DiffOptions, DiffResult } from './compute'

export interface DiffRequest {
  id: number
  left: string
  right: string
  options: DiffOptions
}

export interface DiffReply {
  id: number
  result: DiffResult | DiffError
  elapsedMs: number
}

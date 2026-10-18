import type { Processed, StripOptions } from './lib/types'

export interface ExifRequest {
  id: number
  bytes: Uint8Array<ArrayBuffer>
  options: StripOptions
}

export type ExifReply = { id: number; ok: true; result: Processed } | { id: number; ok: false; error: string }

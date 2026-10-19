/**
 * The PDF worker's messages. Types only, plus two plain helpers — no
 * pdf-lib — so the sub-tool screens can import it and stay small.
 */
import type { PageNumberOptions, WatermarkOptions } from './ops/edit'
import type { MergeResult, NamedBytes, Rotation, SplitMode } from './ops/organize'
import type { UnlockResult } from './ops/security'
import type { MetadataReport, StripMetadataOptions } from './ops/metadata'
import type { FillSignOptions, FillSignResult, FormReport } from './ops/form'

/** Every pdf-lib pipeline, by name: what it takes and what it gives back. */
export interface PdfJobs {
  merge: { args: { inputs: NamedBytes[] }; result: MergeResult }
  split: { args: { bytes: Uint8Array; mode: SplitMode }; result: NamedBytes[] }
  rotate: { args: { bytes: Uint8Array; rotation: Rotation }; result: Uint8Array }
  'remove-pages': { args: { bytes: Uint8Array; spec: string }; result: Uint8Array }
  reorder: { args: { bytes: Uint8Array; spec: string }; result: Uint8Array }
  compress: { args: { bytes: Uint8Array }; result: Uint8Array }
  'page-numbers': { args: { bytes: Uint8Array; options: PageNumberOptions }; result: Uint8Array }
  watermark: { args: { bytes: Uint8Array; options: WatermarkOptions }; result: Uint8Array }
  protect: { args: { bytes: Uint8Array; password: string }; result: Uint8Array }
  unlock: { args: { bytes: Uint8Array; password: string }; result: UnlockResult }
  'image-to-pdf': { args: { inputs: NamedBytes[] }; result: Uint8Array }
  'remove-metadata': { args: { bytes: Uint8Array; options: StripMetadataOptions }; result: MetadataReport }
  'read-form': { args: { bytes: Uint8Array }; result: FormReport }
  'fill-sign': { args: { bytes: Uint8Array; options: FillSignOptions }; result: FillSignResult }
}

export type PdfJob = keyof PdfJobs

/** The operation's name as the person knows it, for timeout and crash messages. */
export const jobLabels: Record<PdfJob, string> = {
  merge: 'Merge PDF',
  split: 'Split PDF',
  rotate: 'Rotate PDF',
  'remove-pages': 'Remove Pages',
  reorder: 'Reorder Pages',
  compress: 'Compress PDF',
  'page-numbers': 'Page Numbers',
  watermark: 'Watermark',
  protect: 'Protect PDF',
  unlock: 'Unlock PDF',
  'image-to-pdf': 'Image to PDF',
  'remove-metadata': 'Remove Metadata',
  'read-form': 'Fill & Sign',
  'fill-sign': 'Fill & Sign',
}

export type PdfRequest = { [K in PdfJob]: { id: number; job: K; args: PdfJobs[K]['args'] } }[PdfJob]

export type PdfReply =
  /** A step of healthy work; restarts the job's deadline. `value` is the job's own count (Merge: files done). */
  | { id: number; type: 'progress'; value?: number }
  | { id: number; type: 'done'; result: PdfJobs[PdfJob]['result'] }
  /** `message` is already written for the person (describeError ran in the worker). */
  | { id: number; type: 'error'; message: string }

/**
 * The ArrayBuffers under every byte array in `value`, each once, to transfer
 * rather than copy. Transferring empties the sender's arrays.
 */
export function transferList(value: unknown): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>()
  const seen = new Set<object>()
  const stack: unknown[] = [value]
  while (stack.length) {
    const v = stack.pop()
    if (typeof v !== 'object' || v === null || seen.has(v)) continue
    seen.add(v)
    if (ArrayBuffer.isView(v)) {
      if (v.buffer instanceof ArrayBuffer) out.add(v.buffer)
    } else if (Array.isArray(v)) stack.push(...v)
    else for (const k of Object.keys(v)) stack.push((v as Record<string, unknown>)[k])
  }
  return [...out]
}

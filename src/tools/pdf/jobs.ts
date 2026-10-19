/**
 * What the PDF worker runs: each job name mapped to its ops/ pipeline, under
 * one Work budget per job. Plain functions, so tests run them in Node and
 * drive the runner with an in-process stand-in for the worker.
 */
import { addPageNumbers, addWatermark, compressPdf } from './ops/edit'
import { fillAndSign, readForm } from './ops/form'
import { imagesToPdf } from './ops/images'
import { removeMetadata } from './ops/metadata'
import { mergePdfs, removePages, reorderPages, rotatePdf, splitPdf } from './ops/organize'
import { protectPdf, unlockPdf } from './ops/security'
import { Work, withWork, type WorkOptions } from './lib/work'
import type { PdfJob, PdfJobs } from './protocol'

export interface JobContext {
  /** A step of healthy work (`value`: the job's own count, Merge's files done). */
  onProgress?: (value?: number) => void
  /** Budget overrides — tests inject small ones. */
  work?: WorkOptions
}

type Handlers = { [K in PdfJob]: (args: PdfJobs[K]['args'], ctx: JobContext) => Promise<PdfJobs[K]['result']> }

const handlers: Handlers = {
  merge: ({ inputs }, ctx) => mergePdfs(inputs, (done) => ctx.onProgress?.(done)),
  split: ({ bytes, mode }) => splitPdf(bytes, mode),
  rotate: ({ bytes, rotation }) => rotatePdf(bytes, rotation),
  'remove-pages': ({ bytes, spec }) => removePages(bytes, spec),
  reorder: ({ bytes, spec }) => reorderPages(bytes, spec),
  compress: ({ bytes }) => compressPdf(bytes),
  'page-numbers': ({ bytes, options }) => addPageNumbers(bytes, options),
  watermark: ({ bytes, options }) => addWatermark(bytes, options),
  protect: ({ bytes, password }) => protectPdf(bytes, password),
  unlock: ({ bytes, password }) => unlockPdf(bytes, password),
  // the screen has already turned anything but PNG and JPEG into PNG (it needs a canvas)
  'image-to-pdf': ({ inputs }) => imagesToPdf(inputs),
  'remove-metadata': ({ bytes, options }) => removeMetadata(bytes, options),
  'read-form': ({ bytes }) => readForm(bytes),
  'fill-sign': ({ bytes, options }) => fillAndSign(bytes, options),
}

export function runJob<K extends PdfJob>(job: K, args: PdfJobs[K]['args'], ctx: JobContext = {}): Promise<PdfJobs[K]['result']> {
  const handler = handlers[job] as Handlers[K] | undefined
  if (!handler) return Promise.reject(new Error(`Unknown PDF job: ${String(job)}`))
  const work = new Work({ ...ctx.work, onStep: () => ctx.onProgress?.() })
  return withWork(work, () => handler(args, ctx))
}

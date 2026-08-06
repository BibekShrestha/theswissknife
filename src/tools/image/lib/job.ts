/**
 * One image, start to finish: resize, encode, and hit a size target if asked.
 *
 * Lives apart from the worker so the same routine serves both the worker and
 * the main-thread fallback, and so the request/response types can be imported
 * without pulling the worker module into the page.
 */

import { computeSize, scaleSize, type ResizeSpec } from './dimensions'
import { encodeCanvas, renderToCanvas, type GifSettings } from './encode'
import { formatInfo, type OutFormat } from './formats'
import { searchForTarget } from './target'

export interface JobOptions {
  format: OutFormat
  resize: ResizeSpec
  /** 0–1, used by JPEG and WebP. */
  quality: number
  /** Size ceiling in bytes, or null to just encode once at `quality`. */
  targetBytes: number | null
  /** Background for formats without alpha; null keeps transparency. */
  matte: string | null
  gif: GifSettings
}

export interface JobOutput {
  blob: Blob
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
  format: OutFormat
  quality: number
  /** Encode passes used — more than one means a size target was hunted down. */
  attempts: number
  /** null when no target was set. */
  targetMet: boolean | null
  upscaled: boolean
  clamped: boolean
}

export async function runJob(bitmap: ImageBitmap, options: JobOptions): Promise<JobOutput> {
  const source = { width: bitmap.width, height: bitmap.height }
  const wanted = computeSize(source, options.resize)
  const info = formatInfo(options.format)

  interface Attempt {
    /** Bytes — the name the target search expects. */
    size: number
    blob: Blob
    width: number
    height: number
  }

  const encodeAt = async ({ quality, scale }: { quality: number; scale: number }): Promise<Attempt> => {
    const target = scale === 1 ? wanted : scaleSize(wanted, scale)
    const canvas = renderToCanvas(bitmap, target, options.matte)
    const blob = await encodeCanvas(canvas, options.format, quality, options.gif)
    return { size: blob.size, blob, width: target.width, height: target.height }
  }

  const common = {
    sourceWidth: source.width,
    sourceHeight: source.height,
    format: options.format,
    upscaled: wanted.upscaled,
    clamped: wanted.clamped,
  }

  if (options.targetBytes == null) {
    const only = await encodeAt({ quality: options.quality, scale: 1 })
    return {
      ...common,
      blob: only.blob,
      width: only.width,
      height: only.height,
      quality: options.quality,
      attempts: 1,
      targetMet: null,
    }
  }

  const search = await searchForTarget(encodeAt, {
    targetBytes: options.targetBytes,
    searchQuality: info.quality,
    quality: options.quality,
  })

  return {
    ...common,
    blob: search.best.blob,
    width: search.best.width,
    height: search.best.height,
    quality: search.params.quality,
    attempts: search.attempts,
    targetMet: search.met,
  }
}

export interface WorkerRequest {
  id: string
  /** Already-decoded pixels (SVG takes this route), transferred in. */
  bitmap?: ImageBitmap
  /** Or the raw file, decoded on the worker thread. */
  blob?: Blob
  options: JobOptions
}

export type WorkerResponse =
  | { id: string; ok: true; output: JobOutput }
  | { id: string; ok: false; message: string }

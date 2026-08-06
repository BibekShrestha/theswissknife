/**
 * The engine every screen shares.
 *
 * Convert, Resize, Compress and All-in-one are the same pipeline with
 * different panels showing, so the queue, the worker plumbing, the warnings
 * and the downloads live here once. A screen supplies its default options and
 * decides which panels to render — nothing else.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import { decodeRaster, measureSvg, rasterizeSvg } from './lib/decode'
import { computeSize, DEFAULT_RESIZE, type ResizeSpec } from './lib/dimensions'
import { sniff, SNIFF_BYTES, type Frames } from './lib/detect'
import { canUseOffscreen, probeEncoders } from './lib/encode'
import {
  formatInfo,
  OUT_FORMATS,
  resolveFormat,
  type FormatChoice,
  type InFormat,
  type OutFormat,
} from './lib/formats'
import { runJob, type JobOptions, type JobOutput, type WorkerRequest, type WorkerResponse } from './lib/job'
import { formatBytes, outputName, uniqueNames, ZIP_NAME } from './lib/naming'

export const MAX_FILES = 30
export const MAX_FILE_BYTES = 30 * 1024 * 1024

export interface PipelineOptions {
  format: FormatChoice
  resize: ResizeSpec
  /** 0–1 for JPEG and WebP. */
  quality: number
  useTarget: boolean
  targetKB: number
  /** Background colour for formats with no alpha. */
  matte: string
  gifColors: number
  gifDither: boolean
}

export const DEFAULT_OPTIONS: PipelineOptions = {
  format: 'keep',
  resize: DEFAULT_RESIZE,
  quality: 0.82,
  useTarget: false,
  targetKB: 200,
  matte: '#ffffff',
  gifColors: 256,
  gifDither: true,
}

export interface ItemResult {
  name: string
  blob: Blob
  url: string
  bytes: number
  width: number
  height: number
  format: OutFormat
  quality: number
  attempts: number
  targetMet: boolean | null
  warnings: string[]
}

export type ItemStatus = 'queued' | 'working' | 'done' | 'error' | 'rejected'

export interface QueueItem {
  id: string
  file: File
  source: InFormat
  frames: Frames
  status: ItemStatus
  result: ItemResult | null
  error: string | null
}

class Cancelled extends Error {}

export function useImagePipeline(defaults?: Partial<PipelineOptions>) {
  const [options, setOptions] = useState<PipelineOptions>({ ...DEFAULT_OPTIONS, ...defaults })
  const [items, setItems] = useState<QueueItem[]>([])
  const [running, setRunning] = useState(false)
  const [completed, setCompleted] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [encoders, setEncoders] = useState<OutFormat[]>(() => OUT_FORMATS.map((f) => f.id))

  const workerRef = useRef<Worker | null>(null)
  const inFlightRef = useRef<((reason: Error) => void) | null>(null)
  const cancelRef = useRef(false)
  const idRef = useRef(0)

  // A browser that cannot write WebP should not offer it in the picker.
  useEffect(() => {
    let alive = true
    probeEncoders()
      .then((list) => alive && setEncoders(list))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const disposeWorker = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
  }, [])

  // Cleanup reads the queue through a ref: object URLs outlive the component
  // unless we revoke them, and unmount is too late to touch state.
  const itemsRef = useRef(items)
  itemsRef.current = items
  useEffect(
    () => () => {
      disposeWorker()
      for (const item of itemsRef.current) if (item.result) URL.revokeObjectURL(item.result.url)
    },
    [disposeWorker],
  )

  const ensureWorker = useCallback((): Worker => {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('./image.worker.ts', import.meta.url), {
        type: 'module',
      })
    }
    return workerRef.current
  }, [])

  const ask = useCallback(
    (request: WorkerRequest, transfer: Transferable[]): Promise<JobOutput> => {
      const worker = ensureWorker()
      return new Promise<JobOutput>((resolve, reject) => {
        const cleanup = (): void => {
          worker.removeEventListener('message', onMessage)
          worker.removeEventListener('error', onError)
          inFlightRef.current = null
        }
        const onMessage = (event: MessageEvent<WorkerResponse>): void => {
          if (event.data.id !== request.id) return
          cleanup()
          if (event.data.ok) resolve(event.data.output)
          else reject(new Error(event.data.message))
        }
        const onError = (): void => {
          cleanup()
          reject(new Error('The image worker stopped unexpectedly'))
        }
        // cancel() rejects this so the queue loop is never left awaiting a
        // worker that has already been terminated
        inFlightRef.current = (reason: Error) => {
          cleanup()
          reject(reason)
        }
        worker.addEventListener('message', onMessage)
        worker.addEventListener('error', onError)
        worker.postMessage(request, transfer)
      })
    },
    [ensureWorker],
  )

  const clearResults = useCallback(() => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.result) URL.revokeObjectURL(item.result.url)
        if (item.status === 'rejected') return item
        return { ...item, status: 'queued', result: null, error: null }
      }),
    )
    setCompleted(0)
  }, [])

  /** Any option change invalidates finished results — they described old settings. */
  const setOption = useCallback(
    <K extends keyof PipelineOptions>(key: K, value: PipelineOptions[K]) => {
      setOptions((prev) => ({ ...prev, [key]: value }))
      clearResults()
    },
    [clearResults],
  )

  const setResize = useCallback(
    (patch: Partial<ResizeSpec>) => {
      setOptions((prev) => ({ ...prev, resize: { ...prev.resize, ...patch } }))
      clearResults()
    },
    [clearResults],
  )

  const addFiles = useCallback(async (incoming: File[]) => {
    // Take what fits and say what did not, rather than truncating in silence.
    const room = Math.max(0, MAX_FILES - itemsRef.current.length)
    const accepted = incoming.slice(0, room)
    const dropped = incoming.length - accepted.length
    setNotice(
      dropped > 0
        ? `${dropped} file${dropped === 1 ? '' : 's'} not added — the queue holds ${MAX_FILES}.`
        : null,
    )

    const prepared: QueueItem[] = []
    for (const file of accepted) {
      const id = `f${idRef.current++}`
      if (file.size > MAX_FILE_BYTES) {
        prepared.push({
          id,
          file,
          source: 'unknown',
          frames: 'unknown',
          status: 'rejected',
          result: null,
          error: `Larger than ${formatBytes(MAX_FILE_BYTES)}`,
        })
        continue
      }
      const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer())
      const { format, frames } = sniff(head)
      prepared.push({
        id,
        file,
        source: format,
        frames,
        status: format === 'unknown' ? 'rejected' : 'queued',
        result: null,
        error: format === 'unknown' ? 'Not an image format this tool can read' : null,
      })
    }
    setItems((prev) => [...prev, ...prepared])
  }, [])

  const removeItem = useCallback((id: string) => {
    setItems((prev) => {
      const item = prev.find((candidate) => candidate.id === id)
      if (item?.result) URL.revokeObjectURL(item.result.url)
      return prev.filter((candidate) => candidate.id !== id)
    })
  }, [])

  const clearAll = useCallback(() => {
    setItems((prev) => {
      for (const item of prev) if (item.result) URL.revokeObjectURL(item.result.url)
      return []
    })
    setCompleted(0)
    setNotice(null)
  }, [])

  const cancel = useCallback(() => {
    cancelRef.current = true
    inFlightRef.current?.(new Cancelled('cancelled'))
    disposeWorker()
  }, [disposeWorker])

  const process = useCallback(
    async (item: QueueItem): Promise<ItemResult> => {
      const format = resolveFormat(options.format, item.source)
      const info = formatInfo(format)
      if (!encoders.includes(format)) {
        throw new Error(`This browser cannot write ${info.label} files`)
      }

      const warnings: string[] = []
      if (item.frames === 'animated') {
        warnings.push('Animated source — only the first frame was converted')
      }
      if (!info.alpha) {
        warnings.push(`Any transparency was flattened onto ${options.matte}`)
      }

      const jobOptions: JobOptions = {
        format,
        resize: options.resize,
        quality: options.quality,
        targetBytes: options.useTarget ? Math.max(1, Math.round(options.targetKB * 1024)) : null,
        matte: info.alpha ? null : options.matte,
        gif: { maxColors: options.gifColors, dither: options.gifDither },
      }

      let output: JobOutput
      if (item.source === 'svg') {
        // Vectors are rasterised once, at the final size, on this thread.
        const measured = await measureSvg(item.file)
        if (measured.assumed) {
          warnings.push('This SVG declares no size — rasterised at 1024 px on the long edge')
        }
        const size = computeSize(measured.intrinsic, options.resize)
        const bitmap = await rasterizeSvg(measured.text, size)
        const svgJob: JobOptions = { ...jobOptions, resize: { ...DEFAULT_RESIZE, mode: 'none' } }
        output = canUseOffscreen()
          ? await ask({ id: item.id, bitmap, options: svgJob }, [bitmap])
          : await runLocally(bitmap, svgJob)
      } else {
        output = canUseOffscreen()
          ? await ask({ id: item.id, blob: item.file, options: jobOptions }, [])
          : await runLocally(await decodeRaster(item.file), jobOptions)
      }

      if (output.upscaled) warnings.push('Enlarged past the original size')
      if (output.clamped) warnings.push('Scaled back to stay inside the browser canvas limit')
      if (output.targetMet === false) {
        warnings.push(
          `Could not reach ${options.targetKB} KB — ${formatBytes(output.blob.size)} was the smallest`,
        )
      }

      return {
        name: outputName(item.file.name, info.ext),
        blob: output.blob,
        url: URL.createObjectURL(output.blob),
        bytes: output.blob.size,
        width: output.width,
        height: output.height,
        format,
        quality: output.quality,
        attempts: output.attempts,
        targetMet: output.targetMet,
        warnings,
      }
    },
    [ask, encoders, options],
  )

  const run = useCallback(async () => {
    const queue = items.filter((item) => item.status !== 'rejected')
    if (queue.length === 0 || running) return

    cancelRef.current = false
    setRunning(true)
    setCompleted(0)
    setItems((prev) =>
      prev.map((item) => {
        if (item.status === 'rejected') return item
        if (item.result) URL.revokeObjectURL(item.result.url)
        return { ...item, status: 'queued', result: null, error: null }
      }),
    )

    for (const item of queue) {
      if (cancelRef.current) break
      setItems((prev) => prev.map((c) => (c.id === item.id ? { ...c, status: 'working' } : c)))
      try {
        const result = await process(item)
        if (cancelRef.current) {
          URL.revokeObjectURL(result.url)
          break
        }
        setItems((prev) =>
          prev.map((c) => (c.id === item.id ? { ...c, status: 'done', result, error: null } : c)),
        )
      } catch (error) {
        if (error instanceof Cancelled) break
        const message = error instanceof Error ? error.message : String(error)
        setItems((prev) =>
          prev.map((c) => (c.id === item.id ? { ...c, status: 'error', error: message } : c)),
        )
      }
      setCompleted((n) => n + 1)
    }

    if (cancelRef.current) {
      setItems((prev) =>
        prev.map((c) => (c.status === 'working' ? { ...c, status: 'queued' } : c)),
      )
    }
    setRunning(false)
  }, [items, process, running])

  const results = useMemo(
    () => items.filter((item) => item.result !== null) as (QueueItem & { result: ItemResult })[],
    [items],
  )

  const downloadOne = useCallback((item: QueueItem) => {
    if (item.result) saveAs(item.result.blob, item.result.name)
  }, [])

  const downloadAll = useCallback(async () => {
    if (results.length === 0) return
    if (results.length === 1) {
      saveAs(results[0].result.blob, results[0].result.name)
      return
    }
    const zip = new JSZip()
    const names = uniqueNames(results.map((item) => item.result.name))
    results.forEach((item, i) => zip.file(names[i], item.result.blob))
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    saveAs(new Blob([bytes as unknown as BlobPart], { type: 'application/zip' }), ZIP_NAME)
  }, [results])

  const totals = useMemo(() => {
    let before = 0
    let after = 0
    for (const item of results) {
      before += item.file.size
      after += item.result.bytes
    }
    return { before, after, saved: before > 0 ? 1 - after / before : 0 }
  }, [results])

  return {
    options,
    setOption,
    setResize,
    items,
    results,
    totals,
    encoders,
    running,
    completed,
    notice,
    pending: items.filter((item) => item.status !== 'rejected').length,
    addFiles,
    removeItem,
    clearAll,
    run,
    cancel,
    downloadOne,
    downloadAll,
  }
}

/** What the panels and the result list are handed. */
export type Pipeline = ReturnType<typeof useImagePipeline>

async function runLocally(bitmap: ImageBitmap, options: JobOptions): Promise<JobOutput> {
  try {
    return await runJob(bitmap, options)
  } finally {
    bitmap.close()
  }
}

import type { Engine, Found } from './engine'

export interface ScanRequest { id: number; engine: Engine; data: Uint8ClampedArray; width: number; height: number }
export interface ScanReply { id: number; found: Found[]; error?: string }

export const SCAN_TIMEOUT_MS = 10_000
/** The WeChat pass may first have to fetch and compile ~2.5 MB of wasm and models. */
export const WECHAT_TIMEOUT_MS = 30_000

/** Long edge the image is drawn at. ZXing's `tryDownscale` retries smaller copies itself. */
export const MAX_EDGE = 2048

export interface ScanResult {
  /** Every code read, empty when none was. */
  found: Found[]
  /** The decoder that read them; null when neither did. */
  engine: Engine | null
  /** Natural size of the image, the coordinate space of every `corners`. */
  width: number
  height: number
}

interface Loaded { source: CanvasImageSource; width: number; height: number; close?: () => void }

/** `onload` rather than `img.decode()`, which can stall while the page is hidden. */
function loadViaImg(blob: Blob): Promise<Loaded> {
  const url = URL.createObjectURL(blob)
  const img = new Image()
  return new Promise<Loaded>((resolve, reject) => {
    img.onload = () => resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('That file is not an image this browser can open'))
    img.src = url
  }).finally(() => URL.revokeObjectURL(url))
}

/** `createImageBitmap` first; `<img>` for what it rejects — SVG in Chrome. */
async function loadImage(blob: Blob, timeoutMs: number): Promise<Loaded> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('The browser took too long to open this image')), timeoutMs)
  })
  const load = createImageBitmap(blob)
    .then((bitmap): Loaded => ({ source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }))
    .catch(() => loadViaImg(blob))
  try {
    return await Promise.race([load, deadline])
  } finally {
    clearTimeout(timer)
  }
}

/** Thrown into a scan that a newer one replaced; callers ignore it. */
export class Superseded extends Error {}

/**
 * Runs the decoders in a worker with a deadline: ZXing first, OpenCV's
 * WeChat decoder only when ZXing finds nothing. Only the latest scan
 * matters: starting one abandons the previous, terminating its worker if a
 * pass was still running.
 */
export function createScanner(spawn: () => Worker, timeoutMs = SCAN_TIMEOUT_MS, wechatTimeoutMs = WECHAT_TIMEOUT_MS) {
  let worker: Worker | null = null
  let nextId = 0
  let generation = 0
  let abort: (() => void) | null = null

  const kill = () => {
    worker?.terminate()
    worker = null
  }

  function pass(engine: Engine, data: Uint8ClampedArray, width: number, height: number, ms: number): Promise<Found[]> {
    const id = ++nextId
    const w = (worker ??= spawn())
    return new Promise((resolve, reject) => {
      const settle = (fn: () => void) => {
        clearTimeout(timer)
        abort = null
        w.onmessage = w.onerror = null
        fn()
      }
      const timer = setTimeout(() => settle(() => {
        kill()
        reject(new Error(`Gave up after ${ms / 1000} s — try a smaller or cropped image`))
      }), ms)
      abort = () => settle(() => { kill(); reject(new Superseded()) })
      w.onmessage = (event: MessageEvent<ScanReply>) => {
        const { id: replyId, found, error } = event.data
        if (replyId === id) settle(() => (error ? reject(new Error(error)) : resolve(found)))
      }
      w.onerror = () => settle(() => { kill(); reject(new Error('The decoder crashed on this image')) })
      w.postMessage({ id, engine, data, width, height } satisfies ScanRequest, [data.buffer])
    })
  }

  /** `onFallback` fires when ZXing came up empty and the WeChat pass starts. */
  async function scan(blob: Blob, onFallback?: () => void): Promise<ScanResult> {
    abort?.()
    const gen = ++generation
    const { source, width, height, close } = await loadImage(blob, timeoutMs)
    try {
      if (!width || !height) throw new Error('That image has no size — an SVG needs width and height to be scanned')
      const k = Math.min(1, MAX_EDGE / Math.max(width, height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * k))
      canvas.height = Math.max(1, Math.round(height * k))
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      // Transparent pixels read as black; a white backdrop keeps dark-on-clear codes readable.
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
      // Each pass transfers its buffer to the worker, so it reads its own copy.
      const pixels = () => ctx.getImageData(0, 0, canvas.width, canvas.height).data

      let engine: Engine = 'zxing'
      let found = await pass(engine, pixels(), canvas.width, canvas.height, timeoutMs)
      if (!found.length) {
        if (gen !== generation) throw new Superseded()
        onFallback?.()
        engine = 'wechat'
        found = await pass(engine, pixels(), canvas.width, canvas.height, wechatTimeoutMs)
      }
      // Map back per axis: rounding the canvas size makes x and y scale slightly differently.
      const kx = canvas.width / width
      const ky = canvas.height / height
      const back = (f: Found): Found => ({ ...f, corners: f.corners.map((p) => ({ x: p.x / kx, y: p.y / ky })) as Found['corners'] })
      return { found: found.map(back), engine: found.length ? engine : null, width, height }
    } finally {
      close?.()
    }
  }

  function dispose() {
    generation++
    abort?.()
    kill()
  }

  return { scan, dispose }
}

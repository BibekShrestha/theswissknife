/**
 * Reads QR codes out of image files: the image is drawn on a canvas here,
 * its pixels go to a ZXing worker, and a worker that misses the deadline is
 * terminated (the next file gets a fresh one). Files are read one at a time.
 */

export interface ScanRequest { id: number; data: Uint8ClampedArray; width: number; height: number }
export interface ScanReply { id: number; texts: string[]; error?: string }

export const SCAN_TIMEOUT_MS = 15_000
/** Long edge the image is drawn at; ZXing's tryDownscale retries smaller copies itself. */
export const MAX_EDGE = 2048

interface Loaded { source: CanvasImageSource; width: number; height: number; close?: () => void }

/** `onload` rather than `img.decode()`, which can stall while the page is hidden. */
function loadViaImg(blob: Blob): Promise<Loaded> {
  const url = URL.createObjectURL(blob)
  const img = new Image()
  return new Promise<Loaded>((resolve, reject) => {
    img.onload = () => resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('Not an image this browser can open'))
    img.src = url
  }).finally(() => URL.revokeObjectURL(url))
}

/** `createImageBitmap` first; `<img>` for what it rejects (SVG in Chrome). */
function loadImage(blob: Blob): Promise<Loaded> {
  return createImageBitmap(blob)
    .then((bitmap): Loaded => ({ source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }))
    .catch(() => loadViaImg(blob))
}

export function createScanner(spawn: () => Worker, timeoutMs = SCAN_TIMEOUT_MS) {
  let worker: Worker | null = null
  let nextId = 0
  let queue: Promise<unknown> = Promise.resolve()
  let disposed = false

  const kill = () => {
    worker?.terminate()
    worker = null
  }

  function decode(data: Uint8ClampedArray, width: number, height: number): Promise<string[]> {
    const id = ++nextId
    const w = (worker ??= spawn())
    return new Promise((resolve, reject) => {
      const settle = (fn: () => void) => {
        clearTimeout(timer)
        w.onmessage = w.onerror = null
        fn()
      }
      const timer = setTimeout(() => settle(() => {
        kill()
        reject(new Error(`Gave up after ${timeoutMs / 1000} s — try a smaller or cropped image`))
      }), timeoutMs)
      w.onmessage = (event: MessageEvent<ScanReply>) => {
        const { id: replyId, texts, error } = event.data
        if (replyId === id) settle(() => (error ? reject(new Error(error)) : resolve(texts)))
      }
      w.onerror = () => settle(() => { kill(); reject(new Error('The decoder crashed on this image')) })
      w.postMessage({ id, data, width, height } satisfies ScanRequest, [data.buffer])
    })
  }

  async function read(blob: Blob): Promise<string[]> {
    if (disposed) throw new Error('Scanner closed')
    const { source, width, height, close } = await loadImage(blob)
    try {
      if (!width || !height) throw new Error('The image has no size (an SVG needs a width and height)')
      const k = Math.min(1, MAX_EDGE / Math.max(width, height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * k))
      canvas.height = Math.max(1, Math.round(height * k))
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      // Transparent pixels read as black; a white backdrop keeps dark-on-clear codes readable.
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
      canvas.width = canvas.height = 0
      return await decode(pixels.data, pixels.width, pixels.height)
    } finally {
      close?.()
    }
  }

  /** Queued: a dozen dropped files decode one after another, not all at once. */
  function scan(blob: Blob): Promise<string[]> {
    const next = queue.then(() => read(blob))
    queue = next.catch(() => undefined)
    return next
  }

  function dispose() {
    disposed = true
    kill()
  }

  return { scan, dispose }
}

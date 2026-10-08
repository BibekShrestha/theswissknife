import type { Found } from './engine'

export interface ScanRequest { id: number; data: Uint8ClampedArray; width: number; height: number; blurs: number[] }
export interface ScanReply { id: number; found: Found | null }

export const SCAN_TIMEOUT_MS = 10_000

/** Long edges tried in order: full detail first, then smaller copies, which
 *  often rescue a blurry or noisy photo by averaging the noise away. */
const EDGES = [2048, 1024, 512]

/** Blur radii (px) for styled codes — see `blurGray`. Spaced ×1.5 so one of
 *  them lands near a third of a module for modules of roughly 3–24 px. */
const BLURS = [1, 2, 3, 5, 8]

export interface ScanResult {
  found: Found | null
  /** Natural size of the image, the coordinate space of `found.corners`. */
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

/** The edges to try for an image whose long side is `long`. */
export function edgesFor(long: number): number[] {
  const out = EDGES.filter((edge) => edge < long)
  return long <= EDGES[0] ? [long, ...out] : out
}

export interface Pass { edge: number; blurs: number[] }

/**
 * Every size as is first — the cheap passes that read ordinary codes — then
 * the blur ladder at 1024 px and below, where it stays fast.
 */
export function planPasses(long: number): Pass[] {
  const edges = edgesFor(long)
  return [
    ...edges.map((edge) => ({ edge, blurs: [0] })),
    ...edges.filter((edge) => edge <= 1024).map((edge) => ({ edge, blurs: BLURS })),
  ]
}

/** Thrown into a scan that a newer one replaced; callers ignore it. */
export class Superseded extends Error {}

/**
 * Runs decode passes in a worker with a deadline. Only the latest scan
 * matters: starting one abandons the previous, terminating its worker if a
 * pass was still running.
 */
export function createScanner(spawn: () => Worker, timeoutMs = SCAN_TIMEOUT_MS) {
  let worker: Worker | null = null
  let nextId = 0
  let generation = 0
  let abort: (() => void) | null = null

  const kill = () => {
    worker?.terminate()
    worker = null
  }

  function pass(data: Uint8ClampedArray, width: number, height: number, blurs: number[]): Promise<Found | null> {
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
        reject(new Error(`Gave up after ${timeoutMs / 1000} s — try a smaller or cropped image`))
      }), timeoutMs)
      abort = () => settle(() => { kill(); reject(new Superseded()) })
      w.onmessage = (event: MessageEvent<ScanReply>) => {
        if (event.data.id === id) settle(() => resolve(event.data.found))
      }
      w.onerror = () => settle(() => { kill(); reject(new Error('The decoder crashed on this image')) })
      w.postMessage({ id, data, width, height, blurs } satisfies ScanRequest, [data.buffer])
    })
  }

  async function scan(blob: Blob): Promise<ScanResult> {
    abort?.()
    const gen = ++generation
    const { source, width, height, close } = await loadImage(blob, timeoutMs)
    try {
      if (!width || !height) throw new Error('That image has no size — an SVG needs width and height to be scanned')
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      for (const { edge, blurs } of planPasses(Math.max(width, height))) {
        if (gen !== generation) throw new Superseded()
        const k = edge / Math.max(width, height)
        canvas.width = Math.max(1, Math.round(width * k))
        canvas.height = Math.max(1, Math.round(height * k))
        // Transparent pixels read as black; a white backdrop keeps dark-on-clear codes readable.
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const found = await pass(data, canvas.width, canvas.height, blurs)
        if (found) {
          // Map back per axis: rounding the canvas size makes x and y scale slightly differently.
          const kx = canvas.width / width
          const ky = canvas.height / height
          const back = (p: { x: number; y: number }) => ({ x: p.x / kx, y: p.y / ky })
          return { found: { ...found, corners: found.corners.map(back) as Found['corners'] }, width, height }
        }
      }
      return { found: null, width, height }
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

import type { Found } from './engine'

export interface ScanRequest { id: number; data: Uint8ClampedArray; width: number; height: number }
export interface ScanReply { id: number; found: Found | null }

export const SCAN_TIMEOUT_MS = 10_000

/** Long edges tried in order: full detail first, then smaller copies, which
 *  often rescue a blurry or noisy photo by averaging the noise away. */
const EDGES = [2048, 1024, 512]

export interface ScanResult {
  found: Found | null
  /** Natural size of the image, the coordinate space of `found.corners`. */
  width: number
  height: number
}

/** Decodes with the browser's own image loader, so anything an <img> can show
 *  works — SVG included, which `createImageBitmap` rejects in Chrome. */
function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  const img = new Image()
  img.src = url
  return img.decode().then(
    () => { URL.revokeObjectURL(url); return img },
    () => { URL.revokeObjectURL(url); throw new Error('That file is not an image this browser can open') },
  )
}

/** The edges to try for an image whose long side is `long`. */
export function edgesFor(long: number): number[] {
  const out = EDGES.filter((edge) => edge < long)
  return long <= EDGES[0] ? [long, ...out] : out
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

  function pass(data: Uint8ClampedArray, width: number, height: number): Promise<Found | null> {
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
      w.postMessage({ id, data, width, height } satisfies ScanRequest, [data.buffer])
    })
  }

  async function scan(blob: Blob): Promise<ScanResult> {
    abort?.()
    const gen = ++generation
    const img = await loadImage(blob)
    const width = img.naturalWidth
    const height = img.naturalHeight
    if (!width || !height) throw new Error('That image has no size — an SVG needs width and height to be scanned')
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    for (const edge of edgesFor(Math.max(width, height))) {
      if (gen !== generation) throw new Superseded()
      const k = edge / Math.max(width, height)
      canvas.width = Math.max(1, Math.round(width * k))
      canvas.height = Math.max(1, Math.round(height * k))
      // Transparent pixels read as black; a white backdrop keeps dark-on-clear codes readable.
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const found = await pass(data, canvas.width, canvas.height)
      if (found) {
        const back = (p: { x: number; y: number }) => ({ x: p.x / k, y: p.y / k })
        return { found: { ...found, corners: found.corners.map(back) as Found['corners'] }, width, height }
      }
    }
    return { found: null, width, height }
  }

  function dispose() {
    generation++
    abort?.()
    kill()
  }

  return { scan, dispose }
}

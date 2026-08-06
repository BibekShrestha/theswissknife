/**
 * RGBA → 256-colour indexed pixels, the step a GIF cannot skip.
 *
 * Median cut over a 5-5-5 histogram picks the palette; a 32k lookup table maps
 * pixels to it so the per-pixel cost is a table read rather than a search over
 * 256 colours. Images that already fit in the palette skip both and map
 * exactly, which keeps screenshots and logos pixel-perfect.
 */

export interface Quantized {
  /** One palette index per pixel, row-major. */
  indices: Uint8Array
  /** RGB triplets: palette.length / 3 colours. */
  palette: Uint8Array
  /** Index reserved for fully transparent pixels, or -1 if none was needed. */
  transparentIndex: number
  /** True when the palette holds every colour of the source exactly. */
  exact: boolean
}

export interface QuantizeOptions {
  /** Palette ceiling, including the transparent slot. 2–256. */
  maxColors?: number
  /** Floyd–Steinberg error diffusion — worth it on photographs. */
  dither?: boolean
  /** Alpha below this becomes fully transparent; GIF has no partial alpha. */
  alphaThreshold?: number
}

/** Colours sampled into the histogram; beyond this we stride over the image. */
const HISTOGRAM_SAMPLE_LIMIT = 1_500_000

export function quantize(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options: QuantizeOptions = {},
): Quantized {
  const pixels = width * height
  if (rgba.length < pixels * 4) throw new Error('quantize: pixel data shorter than width × height')

  const maxColors = Math.max(2, Math.min(256, Math.round(options.maxColors ?? 256)))
  const alphaThreshold = options.alphaThreshold ?? 128
  const hasAlpha = anyTransparent(rgba, pixels, alphaThreshold)
  const colorBudget = hasAlpha ? maxColors - 1 : maxColors

  const exact = exactPalette(rgba, pixels, alphaThreshold, colorBudget)
  const palette = exact ?? medianCutPalette(rgba, pixels, alphaThreshold, colorBudget)
  const transparentIndex = hasAlpha ? palette.length / 3 : -1

  // An exact palette needs no search and no dithering — there is no error to
  // spread around when every colour is already in the table.
  const indices = exact
    ? mapExact(rgba, pixels, alphaThreshold, palette, transparentIndex)
    : mapNearest(
        rgba,
        width,
        height,
        alphaThreshold,
        palette,
        transparentIndex,
        options.dither === true,
      )

  const full = hasAlpha ? withTransparentSlot(palette) : palette
  return { indices, palette: full, transparentIndex, exact: exact !== null }
}

function anyTransparent(
  rgba: Uint8Array | Uint8ClampedArray,
  pixels: number,
  threshold: number,
): boolean {
  for (let i = 0; i < pixels; i++) {
    if (rgba[i * 4 + 3] < threshold) return true
  }
  return false
}

/** Every distinct colour, when there are few enough of them. */
function exactPalette(
  rgba: Uint8Array | Uint8ClampedArray,
  pixels: number,
  threshold: number,
  budget: number,
): Uint8Array | null {
  const seen = new Set<number>()
  for (let i = 0; i < pixels; i++) {
    const p = i * 4
    if (rgba[p + 3] < threshold) continue
    seen.add((rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2])
    if (seen.size > budget) return null
  }
  const keys = [...seen].sort((a, b) => a - b)
  const palette = new Uint8Array(Math.max(1, keys.length) * 3)
  keys.forEach((key, i) => {
    palette[i * 3] = (key >> 16) & 0xff
    palette[i * 3 + 1] = (key >> 8) & 0xff
    palette[i * 3 + 2] = key & 0xff
  })
  return palette
}

interface Entry {
  r: number
  g: number
  b: number
  count: number
}

interface Box {
  start: number
  end: number
  count: number
  span: number
  channel: 0 | 1 | 2
}

function medianCutPalette(
  rgba: Uint8Array | Uint8ClampedArray,
  pixels: number,
  threshold: number,
  budget: number,
): Uint8Array {
  const counts = new Uint32Array(32768)
  const sums = new Float64Array(32768 * 3)
  const stride = Math.max(1, Math.ceil(pixels / HISTOGRAM_SAMPLE_LIMIT))

  for (let i = 0; i < pixels; i += stride) {
    const p = i * 4
    if (rgba[p + 3] < threshold) continue
    const r = rgba[p]
    const g = rgba[p + 1]
    const b = rgba[p + 2]
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    counts[key]++
    sums[key * 3] += r
    sums[key * 3 + 1] += g
    sums[key * 3 + 2] += b
  }

  const entries: Entry[] = []
  for (let key = 0; key < counts.length; key++) {
    const count = counts[key]
    if (count === 0) continue
    entries.push({
      r: sums[key * 3] / count,
      g: sums[key * 3 + 1] / count,
      b: sums[key * 3 + 2] / count,
      count,
    })
  }

  if (entries.length === 0) return new Uint8Array([0, 0, 0])

  const boxes: Box[] = [describe(entries, 0, entries.length)]
  while (boxes.length < budget) {
    let pick = -1
    let bestScore = 0
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]
      if (box.end - box.start < 2 || box.span === 0) continue
      const score = box.span * Math.log2(box.count + 1)
      if (score > bestScore) {
        bestScore = score
        pick = i
      }
    }
    if (pick === -1) break

    const box = boxes[pick]
    sortRange(entries, box.start, box.end, box.channel)
    const half = box.count / 2
    let seen = 0
    let split = box.start + 1
    for (let i = box.start; i < box.end - 1; i++) {
      seen += entries[i].count
      if (seen >= half) {
        split = i + 1
        break
      }
    }
    // both halves must keep at least one colour, or a box averages nothing
    split = Math.min(Math.max(split, box.start + 1), box.end - 1)
    boxes[pick] = describe(entries, box.start, split)
    boxes.push(describe(entries, split, box.end))
  }

  const palette = new Uint8Array(boxes.length * 3)
  boxes.forEach((box, i) => {
    let r = 0
    let g = 0
    let b = 0
    let total = 0
    for (let j = box.start; j < box.end; j++) {
      const e = entries[j]
      r += e.r * e.count
      g += e.g * e.count
      b += e.b * e.count
      total += e.count
    }
    palette[i * 3] = clamp255(Math.round(r / total))
    palette[i * 3 + 1] = clamp255(Math.round(g / total))
    palette[i * 3 + 2] = clamp255(Math.round(b / total))
  })
  return palette
}

function describe(entries: Entry[], start: number, end: number): Box {
  let rMin = 255
  let rMax = 0
  let gMin = 255
  let gMax = 0
  let bMin = 255
  let bMax = 0
  let count = 0
  for (let i = start; i < end; i++) {
    const e = entries[i]
    if (e.r < rMin) rMin = e.r
    if (e.r > rMax) rMax = e.r
    if (e.g < gMin) gMin = e.g
    if (e.g > gMax) gMax = e.g
    if (e.b < bMin) bMin = e.b
    if (e.b > bMax) bMax = e.b
    count += e.count
  }
  // weights approximate perceived brightness, so greens split before blues
  const spans: [number, 0 | 1 | 2][] = [
    [(rMax - rMin) * 1.2, 0],
    [(gMax - gMin) * 1.5, 1],
    [bMax - bMin, 2],
  ]
  spans.sort((a, b) => b[0] - a[0])
  return { start, end, count, span: spans[0][0], channel: spans[0][1] }
}

function sortRange(entries: Entry[], start: number, end: number, channel: 0 | 1 | 2): void {
  const key = channel === 0 ? 'r' : channel === 1 ? 'g' : 'b'
  const slice = entries.slice(start, end).sort((a, b) => a[key] - b[key])
  for (let i = 0; i < slice.length; i++) entries[start + i] = slice[i]
}

function mapExact(
  rgba: Uint8Array | Uint8ClampedArray,
  pixels: number,
  threshold: number,
  palette: Uint8Array,
  transparentIndex: number,
): Uint8Array {
  const lookup = new Map<number, number>()
  for (let i = 0; i < palette.length / 3; i++) {
    lookup.set((palette[i * 3] << 16) | (palette[i * 3 + 1] << 8) | palette[i * 3 + 2], i)
  }
  const indices = new Uint8Array(pixels)
  for (let i = 0; i < pixels; i++) {
    const p = i * 4
    if (rgba[p + 3] < threshold && transparentIndex >= 0) {
      indices[i] = transparentIndex
      continue
    }
    indices[i] = lookup.get((rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2]) ?? 0
  }
  return indices
}

function mapNearest(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number,
  palette: Uint8Array,
  transparentIndex: number,
  dither: boolean,
): Uint8Array {
  const pixels = width * height
  const indices = new Uint8Array(pixels)
  const cache = new Int16Array(32768).fill(-1)
  // error carried into the current row and the next one (r,g,b per pixel)
  let rowError = dither ? new Float32Array(width * 3) : null
  let nextError = dither ? new Float32Array(width * 3) : null

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const p = i * 4
      if (rgba[p + 3] < threshold && transparentIndex >= 0) {
        indices[i] = transparentIndex
        continue
      }
      let r = rgba[p]
      let g = rgba[p + 1]
      let b = rgba[p + 2]
      if (rowError) {
        r = clamp255(Math.round(r + rowError[x * 3]))
        g = clamp255(Math.round(g + rowError[x * 3 + 1]))
        b = clamp255(Math.round(b + rowError[x * 3 + 2]))
      }

      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
      let index = cache[key]
      if (index < 0) {
        index = nearestIndex(palette, r, g, b)
        cache[key] = index
      }
      indices[i] = index

      if (rowError && nextError) {
        diffuse(rowError, nextError, x, width, [
          r - palette[index * 3],
          g - palette[index * 3 + 1],
          b - palette[index * 3 + 2],
        ])
      }
    }
    if (rowError && nextError) {
      rowError = nextError
      nextError = new Float32Array(width * 3)
    }
  }
  return indices
}

/** Floyd–Steinberg: 7/16 right, 3/16 below-left, 5/16 below, 1/16 below-right. */
function diffuse(
  row: Float32Array,
  next: Float32Array,
  x: number,
  width: number,
  error: [number, number, number],
): void {
  for (let c = 0; c < 3; c++) {
    const e = error[c]
    if (e === 0) continue
    if (x + 1 < width) row[(x + 1) * 3 + c] += (e * 7) / 16
    if (x > 0) next[(x - 1) * 3 + c] += (e * 3) / 16
    next[x * 3 + c] += (e * 5) / 16
    if (x + 1 < width) next[(x + 1) * 3 + c] += e / 16
  }
}

function nearestIndex(palette: Uint8Array, r: number, g: number, b: number): number {
  let best = 0
  let bestDistance = Infinity
  for (let i = 0; i < palette.length / 3; i++) {
    const dr = r - palette[i * 3]
    const dg = g - palette[i * 3 + 1]
    const db = b - palette[i * 3 + 2]
    // luma-weighted distance: closer to how the eye judges a colour swap
    const distance = dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114
    if (distance < bestDistance) {
      bestDistance = distance
      best = i
      if (distance === 0) break
    }
  }
  return best
}

function withTransparentSlot(palette: Uint8Array): Uint8Array {
  const out = new Uint8Array(palette.length + 3)
  out.set(palette)
  return out
}

function clamp255(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value
}

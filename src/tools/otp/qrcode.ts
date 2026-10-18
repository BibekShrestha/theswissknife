import { encode } from 'uqr'

/** Quiet zone, in modules — the four the QR spec asks for. */
export const QUIET = 4

export interface QrPath {
  /** Side in modules, quiet zone included. */
  dim: number
  /** SVG path data, one subpath per horizontal run of dark modules. */
  d: string
}

/** Encodes `text` at ECC level M and draws it as one SVG path. */
export function qrPath(text: string): QrPath {
  const { size, data } = encode(text, { ecc: 'M', border: 0 })
  let d = ''
  for (let r = 0; r < size; r++) {
    let c = 0
    while (c < size) {
      if (!data[r][c]) { c++; continue }
      const start = c
      while (c < size && data[r][c]) c++
      d += `M${start + QUIET} ${r + QUIET}h${c - start}v1h${start - c}z`
    }
  }
  return { dim: size + 2 * QUIET, d }
}

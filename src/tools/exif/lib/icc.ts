/** ICC profile header and description — enough to say which profile it is. */
import { ascii, formatBytes, u16be, u32be, utf16 } from './bytes'
import type { Row } from './types'

const CLASSES: Record<string, string> = {
  scnr: 'Input device',
  mntr: 'Display',
  prtr: 'Output device',
  link: 'Device link',
  spac: 'Colour space',
  abst: 'Abstract',
  nmcl: 'Named colour',
}

const fourcc = (b: Uint8Array, o: number) => ascii(b, o, o + 4).replace(/\0+$/, '').trim()

function textTag(b: Uint8Array, start: number, size: number): string | undefined {
  const end = Math.min(b.length, start + size)
  const type = ascii(b, start, start + 4)
  if (type === 'desc' && start + 12 <= end) {
    const n = u32be(b, start + 8)
    return ascii(b, start + 12, Math.min(end, start + 12 + n)).replace(/\0+$/, '')
  }
  if (type === 'text') return ascii(b, start + 8, end).replace(/\0+$/, '')
  if (type === 'mluc' && start + 16 <= end) {
    const records = u32be(b, start + 8)
    if (records < 1 || start + 28 > end) return undefined
    const len = u32be(b, start + 20)
    const off = u32be(b, start + 24)
    if (start + off + len > end) return undefined
    return utf16(b.subarray(start + off, start + off + len), false)
  }
  return undefined
}

export interface Icc {
  rows: Row[]
  description?: string
}

/** Reads the ICC profile in b[start, end); never throws. */
export function parseIcc(b: Uint8Array, start: number, end: number): Icc {
  const len = end - start
  const rows: Row[] = [{ key: 'Size', value: formatBytes(len) }]
  if (len < 132 || ascii(b, start + 36, start + 40) !== 'acsp') {
    rows.push({ key: 'Profile', value: 'No ICC header (signature acsp missing)' })
    return { rows }
  }
  const p = b.subarray(start, end)
  const tags = new Map<string, [number, number]>()
  const count = Math.min(u32be(p, 128), 200)
  for (let i = 0; i < count && 132 + i * 12 + 12 <= p.length; i++) {
    const e = 132 + i * 12
    tags.set(ascii(p, e, e + 4), [u32be(p, e + 4), u32be(p, e + 8)])
  }
  const read = (sig: string) => {
    const t = tags.get(sig)
    return t ? textTag(p, t[0], t[1])?.trim() : undefined
  }
  const description = read('desc')
  if (description) rows.push({ key: 'Description', value: description })
  // A profile made for one device can name it: the header signatures and the dmnd/dmdd text tags.
  const signature = (o: number) => {
    if (u32be(p, o) === 0) return undefined
    const s = ascii(p, o, o + 4)
    return /^[\x20-\x7e]{4}$/.test(s) ? s.trim() : `0x${u32be(p, o).toString(16).padStart(8, '0')}`
  }
  // Stock profiles carry generic signatures ("APPL", "IEC "); device text, or a camera/scanner profile, is what can point at one device.
  const inputDevice = ascii(p, 12, 16) === 'scnr'
  const device = (key: string, textValue: string | undefined, sig: string | undefined) => {
    const value = textValue && sig ? `${textValue} (${sig})` : textValue || sig
    if (value) rows.push({ key, value, sensitive: !!textValue || inputDevice })
  }
  device('Device maker', read('dmnd'), signature(48))
  device('Device model', read('dmdd'), signature(52))
  rows.push({ key: 'Version', value: `${p[8]}.${p[9] >> 4}.${p[9] & 0xf}` })
  rows.push({ key: 'Class', value: CLASSES[ascii(p, 12, 16)] ?? fourcc(p, 12) })
  rows.push({ key: 'Colour space', value: fourcc(p, 16) })
  rows.push({ key: 'Connection space', value: fourcc(p, 20) })
  const year = u16be(p, 24)
  if (year) rows.push({ key: 'Created', value: `${year}-${String(u16be(p, 26)).padStart(2, '0')}-${String(u16be(p, 28)).padStart(2, '0')}` })
  const cmm = fourcc(p, 4)
  if (cmm) rows.push({ key: 'CMM', value: cmm })
  const creator = fourcc(p, 80)
  if (creator) rows.push({ key: 'Creator', value: creator })
  const copyright = read('cprt')
  if (copyright) rows.push({ key: 'Copyright', value: copyright })
  return { rows, description }
}

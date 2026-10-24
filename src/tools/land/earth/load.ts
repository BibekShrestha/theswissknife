/**
 * A dropped .kml or .kmz as KML text. KMZ is a zip whose first .kml at the
 * root (doc.kml by convention) is the document; jszip loads only when a KMZ
 * arrives. Sizes are capped before anything is inflated, so a zip bomb is
 * refused rather than unpacked.
 */

import { declaredEncoding } from './xml'

export const MAX_FILE = 20 * 1024 * 1024
export const MAX_KML = 64 * 1024 * 1024

export class LoadError extends Error {}

const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04

function decode(bytes: Uint8Array): string {
  const label = declaredEncoding(new TextDecoder('latin1').decode(bytes.subarray(0, 200)))
  if (label && !/^utf-?8$/i.test(label)) {
    try { return new TextDecoder(label).decode(bytes) } catch { /* unknown label: read as UTF-8 */ }
  }
  return new TextDecoder('utf-8').decode(bytes)
}

export async function kmlFromFile(name: string, bytes: Uint8Array): Promise<string> {
  if (bytes.length > MAX_FILE) throw new LoadError(`The file is larger than ${MAX_FILE / 1024 / 1024} MB — a plot outline is a few kilobytes.`)
  if (/\.dwg$|\.dxf$/i.test(name)) throw new LoadError('This is a CAD drawing. Convert it to KML with the KML ⇄ DXF tool first, or draw the plot in Google Earth.')
  if (!isZip(bytes)) {
    const text = decode(bytes)
    if (!/<kml[\s>]|<Placemark[\s>]|<Document[\s>]/.test(text.slice(0, 4096))) throw new LoadError('Not a KML or KMZ file. In Google Earth, save the plot with “Save Place As…” and pick KML or KMZ.')
    return text
  }
  const { default: JSZip } = await import('jszip')
  let zip: InstanceType<typeof JSZip>
  try { zip = await JSZip.loadAsync(bytes) } catch { throw new LoadError('This zip file could not be read.') }
  const kmls = Object.values(zip.files).filter((f) => !f.dir && /\.kml$/i.test(f.name))
  const main = kmls.find((f) => f.name.toLowerCase() === 'doc.kml') ?? kmls.find((f) => !f.name.includes('/')) ?? kmls[0]
  if (!main) throw new LoadError('This KMZ has no .kml inside.')
  // jszip keeps the central directory's size; check it before inflating.
  const size = (main as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
  if (size !== undefined && size > MAX_KML) throw new LoadError('The KML inside this KMZ is unreasonably large.')
  return decode(await main.async('uint8array'))
}

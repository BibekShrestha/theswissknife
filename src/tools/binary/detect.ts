/**
 * Auto-detection: decode the bytes as all three formats and rank the
 * results. A format that reads every byte beats one that stops early; a
 * single item beats a CBOR sequence / MessagePack stream of many; odd
 * protobuf field numbers and many non-shortest encodings count against.
 * The reason string says what the runners-up made of the bytes.
 */

import { decodeCbor } from './cbor'
import { decodeMsgpack } from './msgpack'
import { decodeProtobuf, type ProtobufOptions } from './protobuf'
import { formatLabel, type DecodeResult, type Detection, type Format } from './types'
import { Budget, plural } from './util'

export function decodeAs(format: Format, bytes: Uint8Array, pb: ProtobufOptions): DecodeResult {
  if (format === 'cbor') return decodeCbor(bytes, new Budget())
  if (format === 'msgpack') return decodeMsgpack(bytes, new Budget())
  return decodeProtobuf(bytes, pb, new Budget())
}

function fieldNumber(label: string): number {
  const m = /(\d+)\)?$/.exec(label)
  return m ? Number(m[1]) : 0
}

export function score(r: DecodeResult, bytes: Uint8Array): number {
  const len = bytes.length
  if (!len) return 0
  if (r.errors.length) return 40 * (r.consumed / len)
  let s = 100
  if (r.format === 'protobuf') {
    s = 97
    let max = 0
    for (const n of r.nodes) max = Math.max(max, fieldNumber(n.label))
    if (max > 65535) s -= 25
    else if (max > 1000) s -= 10
    if (r.nodes.some((n) => n.kind === 'SGROUP')) s -= 10
  } else {
    s -= 8 * Math.min(r.items - 1, 6)
    s -= Math.min(15, 3 * r.warnings.filter((w) => /shortest|argument bytes/.test(w.message)).length)
  }
  if (r.format === 'cbor' && bytes[0] === 0xd9 && bytes[1] === 0xd9 && bytes[2] === 0xf7) s += 30
  return s
}

const stopsAt = (r: DecodeResult) => `${formatLabel[r.format]} stops at byte ${r.errors[0].offset} (${r.errors[0].message.replace(/\.$/, '')})`

export function detect(results: Record<Format, DecodeResult>, bytes: Uint8Array): Detection {
  const order: Format[] = ['protobuf', 'cbor', 'msgpack']
  const ranked = order.map((format) => ({ format, r: results[format], s: score(results[format], bytes) })).sort((a, b) => b.s - a.s)
  const best = ranked[0]
  const clean = ranked.filter((x) => !x.r.errors.length)
  const failed = ranked.slice(1).filter((o) => o.r.errors.length)
  const sequence = (r: DecodeResult) => (r.format !== 'protobuf' && r.items > 1 ? ` as a sequence of ${plural(r.items, 'item')}` : '')
  const failedText = failed.length ? ` ${failed.map((o) => stopsAt(o.r)).join('; ')}.` : ''

  if (!bytes.length) return { format: best.format, confidence: 'low', reason: 'No bytes yet.' }
  if (!clean.length) {
    return {
      format: best.format,
      confidence: 'low',
      reason: `No format reads every byte; showing the one that gets furthest. ${stopsAt(best.r)};${failedText}`,
    }
  }
  // A clean reading far behind (a long run of MessagePack fixints) is mentioned, not a rival.
  const alsoClean = clean.filter((c) => c.format !== best.format && c.s > best.s - 20)
  const distant = clean.filter((c) => c.format !== best.format && c.s <= best.s - 20)
  const distantText = distant.length ? ` ${distant.map((c) => `${formatLabel[c.format]} also reads it, but only${sequence(c.r)}`).join('; ')}.` : ''
  if (!alsoClean.length) {
    const single = best.format === 'protobuf' || best.r.items === 1
    return {
      format: best.format,
      confidence: single ? 'high' : 'medium',
      reason: `${distant.length ? '' : 'Only '}${formatLabel[best.format]} reads every byte${sequence(best.r)}${distant.length ? ' as one item' : ''}.${distantText}${failedText}`,
    }
  }
  return {
    format: best.format,
    confidence: 'medium',
    reason: `${formatLabel[best.format]} reads every byte${sequence(best.r)}, but so does ${alsoClean.map((c) => `${formatLabel[c.format]}${sequence(c.r)}`).join(' and ')} — switch format if this reading looks wrong.${failedText}`,
  }
}

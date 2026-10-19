/** The worker's one entry point: parse the optional .proto, decode (or detect and decode), cap the warning list. */

import { decodeAs, detect } from './detect'
import { parseProto } from './proto-schema'
import type { ProtobufOptions } from './protobuf'
import { emptyResult, type DecodeRequest, type DecodeResponse, type DecodeResult, type Detection, type Format, type SchemaSummary } from './types'

const MAX_WARNINGS = 500

export function handleDecode(request: Omit<DecodeRequest, 'id'>): DecodeResponse {
  const started = performance.now()
  const { bytes, format, options } = request
  try {
    let schemaSummary: SchemaSummary | null = null
    const pb: ProtobufOptions = { packed: options.packed }
    if (options.proto.trim()) {
      const schema = parseProto(options.proto)
      const root = schema.messages.has(options.root) ? options.root : schema.order[0] ?? null
      pb.schema = schema
      pb.root = root ? schema.messages.get(root) ?? null : null
      schemaSummary = { messages: schema.order, root, errors: schema.errors, notes: schema.notes }
    }
    let result: DecodeResult
    let detection: Detection | null = null
    if (format === 'auto') {
      const formats: Format[] = ['protobuf', 'cbor', 'msgpack']
      const results = Object.fromEntries(formats.map((f) => [f, decodeAs(f, bytes, pb)])) as Record<Format, DecodeResult>
      detection = detect(results, bytes)
      result = results[detection.format]
    } else {
      result = decodeAs(format, bytes, pb)
    }
    if (result.warnings.length > MAX_WARNINGS) {
      const more = result.warnings.length - MAX_WARNINGS
      result.warnings = result.warnings.slice(0, MAX_WARNINGS)
      result.warnings.push({ offset: result.warnings[MAX_WARNINGS - 1].offset, message: `…and ${more.toLocaleString('en-US')} more warnings` })
    }
    return { result, detection, schema: schemaSummary, error: null, elapsedMs: performance.now() - started }
  } catch (error) {
    return {
      result: emptyResult(format === 'auto' ? 'protobuf' : format),
      detection: null,
      schema: null,
      error: `The decoder failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
      elapsedMs: performance.now() - started,
    }
  }
}

/** Shared shapes for the binary decoder. Everything here crosses the worker boundary, so it is plain data (no bigint, no Map). */

export type Format = 'protobuf' | 'cbor' | 'msgpack'
export type FormatChoice = Format | 'auto'

export const formatLabel: Record<Format, string> = {
  protobuf: 'Protobuf',
  cbor: 'CBOR',
  msgpack: 'MessagePack',
}

/** One way of reading a scalar (a varint as unsigned, signed and zigzag; a fixed32 as int, uint and float). */
export interface Reading {
  name: string
  value: string
}

/**
 * One interpretation of a byte range that has several (a protobuf
 * length-delimited field as message, text, packed numbers or bytes; a CBOR
 * tag 24 as bytes or embedded CBOR). Each view carries its own children.
 */
export interface View {
  name: string
  value: string
  kind?: string
  children?: DNode[]
}

export interface Note {
  level: 'warn' | 'info'
  text: string
}

/** A decoded item. `start..end` is its whole byte range; `start..head` is its header (tag, type byte, length prefix). */
export interface DNode {
  label: string
  kind: string
  start: number
  end: number
  head: number
  value?: string
  readings?: Reading[]
  views?: View[]
  /** Index into `views` of the reading picked by default. */
  view?: number
  children?: DNode[]
  /** A map entry's key (CBOR / MessagePack); its bytes are highlighted with the value's. */
  key?: DNode
  notes?: Note[]
  /** Notation hints for containers: how a diagnostic-style rendering wraps the children. */
  syn?: 'array' | 'map' | 'tag' | 'chunks' | 'ext'
  indef?: boolean
  tag?: string
}

export interface Issue {
  offset: number
  message: string
}

export interface DecodeResult {
  format: Format
  nodes: DNode[]
  /** Fatal problems: decoding stopped at the first one. */
  errors: Issue[]
  /** Well-formed but questionable (non-shortest forms, unsorted keys, invalid UTF-8 in a text string…). */
  warnings: Issue[]
  /** Stopped at the item cap rather than at the end of the input. */
  truncated: boolean
  /** Byte offset where decoding stopped (input length when it read everything). */
  consumed: number
  /** Top-level items (CBOR sequences and MessagePack streams can hold several); fields for protobuf. */
  items: number
}

export interface Detection {
  format: Format
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

export interface DecodeOptions {
  /** Protobuf: also offer length-delimited fields as packed repeated varints / fixed32 / fixed64. */
  packed: boolean
  /** Protobuf: optional .proto source used to name fields. */
  proto: string
  /** Protobuf: fully qualified message name to decode the input as (defaults to the first message). */
  root: string
}

export interface DecodeRequest {
  id: number
  bytes: Uint8Array
  format: FormatChoice
  options: DecodeOptions
}

export interface SchemaSummary {
  messages: string[]
  root: string | null
  errors: string[]
  notes: string[]
}

export interface DecodeResponse {
  result: DecodeResult
  detection: Detection | null
  schema: SchemaSummary | null
  error: string | null
  elapsedMs: number
}

export interface WorkerMessage {
  type: 'result'
  id: number
  result: DecodeResponse
}

/** Limits that keep hostile input from exhausting memory or the call stack. */
export const MAX_DEPTH = 64
export const MAX_NODES = 100_000
/** Text and byte previews are cut at these sizes (the hex view shows every byte). */
export const TEXT_PREVIEW = 2000
export const BYTES_PREVIEW = 512
export const MAX_INPUT_BYTES = 32 * 1024 * 1024
export const DECODE_TIMEOUT_MS = 5000

export const emptyResult = (format: Format): DecodeResult => ({ format, nodes: [], errors: [], warnings: [], truncated: false, consumed: 0, items: 0 })

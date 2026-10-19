/**
 * One run: text → samples → Shape → model → code + notes. Plain functions
 * (no DOM), used by the worker and by the tests. The Shape of the last input
 * is cached, so changing an output option doesn't re-read a large paste.
 */

import { emitGo } from './emit/go'
import { emitJsonSchema } from './emit/jsonschema'
import { emitPython, type PythonFlavor } from './emit/python'
import { emitTypeScript, type TsOptions } from './emit/typescript'
import { emitZod } from './emit/zod'
import { addValue, MAX_DEPTH, newShape, type InferState, type Shape } from './infer'
import { buildModel, type Findings, type ModelOptions } from './model'
import { describeError, parseDoc, splitDocuments, type ParseError } from './parse'

export type Target = 'typescript' | 'zod' | 'jsonschema' | 'go' | 'python'

export interface InferOptions extends ModelOptions {
  /** Each element of a top-level array is a sample of the root type. */
  arrayAsSamples: boolean
  target: Target
  ts: TsOptions
  python: PythonFlavor
}

export interface Note {
  level: 'info' | 'warn'
  text: string
  paths?: string[]
}

export interface InferStats {
  samples: number
  documents: number
  layout: 'json' | 'jsonl' | 'documents'
  values: number
  types: number
}

export type InferResult =
  | { ok: true; code: string; notes: Note[]; stats: InferStats }
  | { ok: false; error: ParseError }
  | { ok: false; empty: true }

interface Inferred {
  shape: Shape
  state: InferState
  approximate: boolean
  stats: Omit<InferStats, 'types'>
}

let cache: { text: string; arrayAsSamples: boolean; result: Inferred | ParseError } | null = null

export function inferShape(text: string, arrayAsSamples: boolean): Inferred | ParseError {
  if (cache && cache.text === text && cache.arrayAsSamples === arrayAsSamples) return cache.result
  const result = read(text, arrayAsSamples)
  cache = { text, arrayAsSamples, result }
  return result
}

function read(text: string, arrayAsSamples: boolean): Inferred | ParseError {
  const docs = splitDocuments(text)
  const shape = newShape()
  const state: InferState = { values: 0 }
  let approximate = false
  let samples = 0
  for (let index = 0; index < docs.length; index++) {
    let parsed
    try {
      parsed = parseDoc(docs[index].text)
    } catch (error) {
      return describeError(text, docs[index], index + 1, error)
    }
    approximate ||= parsed.approximate
    if (arrayAsSamples && Array.isArray(parsed.value)) {
      // The array itself sits at depth 0, so its elements start at depth 1 like they would inside it.
      for (const item of parsed.value) addValue(shape, item, 1, state)
      samples += parsed.value.length
    } else {
      addValue(shape, parsed.value, 0, state)
      samples++
    }
  }
  const oneLineEach = docs.length > 1 && docs.every((doc, index) => !doc.text.includes('\n') && (index === 0 || doc.line > docs[index - 1].line))
  return {
    shape,
    state,
    approximate,
    stats: { samples, documents: docs.length, layout: docs.length <= 1 ? 'json' : oneLineEach ? 'jsonl' : 'documents', values: state.values },
  }
}

const list = (paths: string[], limit = 24) => (paths.length > limit ? [...paths.slice(0, limit), `… ${paths.length - limit} more`] : paths)

function notesFor(findings: Findings, options: InferOptions, inferred: Inferred): Note[] {
  const notes: Note[] = []
  if (findings.deep.length) {
    notes.push({ level: 'warn', text: `Nested deeper than ${MAX_DEPTH} levels — typed unknown, not inferred:`, paths: list(findings.deep) })
  }
  if (findings.bigs.length) {
    notes.push({
      level: 'warn',
      text: inferred.approximate
        ? 'Integers past 2^53 (this browser can’t show JSON.parse the source text, so 1e20-style floats count too, and 1.0 counts as an integer). JSON.parse rounds them — read these with a bigint-aware parser:'
        : 'Integers past 2^53 — JSON.parse rounds them, so read these with a bigint-aware parser (Go output uses json.Number):',
      paths: list(findings.bigs),
    })
  } else if (inferred.approximate) {
    notes.push({ level: 'info', text: 'Numbers were read without their source text, so a float written as 1.0 counts as an integer.' })
  }
  if (findings.formats.length) {
    const paths = findings.formats.map((item) => `${item.path} — ${item.format}`)
    notes.push(options.formats
      ? { level: 'info', text: 'Formats applied (every sample matched):', paths: list(paths) }
      : { level: 'info', text: 'These strings all match a format. Turn on Formats to refine them:', paths: list(paths) })
  }
  if (findings.enums.length) {
    const paths = findings.enums.map((item) => `${item.path} — ${item.values.map((value) => JSON.stringify(value)).join(', ')}`)
    notes.push(options.enums
      ? { level: 'info', text: 'Enums from repeated values (a new value in real data will fail them):', paths: list(paths) }
      : { level: 'info', text: `These strings take at most ${options.enumMax} distinct values, each repeated. Turn on Enums to list them:`, paths: list(paths) })
  }
  if (findings.unions.length) notes.push({ level: 'info', text: 'More than one JSON type seen — typed as a union:', paths: list(findings.unions) })
  if (findings.nullOnly.length) notes.push({ level: 'info', text: 'Only ever null — typed null; a sample with a value would say more:', paths: list(findings.nullOnly) })
  if (findings.emptyOnly.length) notes.push({ level: 'info', text: 'Only empty arrays — items typed unknown:', paths: list(findings.emptyOnly) })
  return notes
}

export function runInference(text: string, options: InferOptions): InferResult {
  if (!text.trim()) return { ok: false, empty: true }
  const inferred = inferShape(text, options.arrayAsSamples)
  if ('message' in inferred) return { ok: false, error: inferred }
  if (!inferred.stats.samples) return { ok: false, empty: true }
  const model = buildModel(inferred.shape, options)
  const notes = notesFor(model.findings, options, inferred)
  let code: string
  switch (options.target) {
    case 'typescript':
      code = emitTypeScript(model, options.ts)
      break
    case 'zod':
      code = emitZod(model, { readonly: options.ts.readonly })
      break
    case 'jsonschema':
      code = emitJsonSchema(model)
      break
    case 'go': {
      const go = emitGo(model, options.formats)
      code = go.code
      if (go.skipped.length) notes.unshift({ level: 'warn', text: 'Keys a Go struct tag can’t hold (quotes, commas, backslashes…) — left out of the structs:', paths: list(go.skipped.map((key) => JSON.stringify(key))) })
      break
    }
    case 'python':
      code = emitPython(model, options.python, options.formats)
      break
  }
  return { ok: true, code, notes, stats: { ...inferred.stats, types: model.decls.length } }
}

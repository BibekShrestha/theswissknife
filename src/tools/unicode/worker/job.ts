import { analyze, cpLabel, type Analysis, type Finding, type Stats } from '../lib/analyze'
import { decodeEscapes } from '../lib/unescape'
import { buildPage, cleanView, normalizeView, type CleanOptions, type CleanView, type Form, type NameLookup, type NormalizeView, type Page } from '../lib/views'

/**
 * One request, as the worker runs it. The last analysis is kept, so turning a
 * page or switching views does not re-scan the text.
 */

export type View = { kind: 'chars' } | { kind: 'normalize', form: Form } | { kind: 'clean', options: CleanOptions }

export interface InspectRequest {
  id: number
  input: string
  escapes: boolean
  page: number
  view: View
}

export interface NamesState {
  status: 'ok' | 'unavailable'
  version: string | null
}

export interface LabelledFinding extends Finding {
  /** Display label per occurrence, same order: `U+200B ZWSP · ZERO WIDTH SPACE`. */
  labels: string[]
}

export interface InspectResult {
  stats: Stats
  findings: LabelledFinding[]
  page: Page
  names: NamesState
  decoded: { decoded: number, invalid: number } | null
  normalize?: NormalizeView
  clean?: CleanView
}

export type InspectReply = { id: number, ok: true, result: InspectResult } | { id: number, ok: false, message: string }

export interface NamesModule {
  nameOf: NameLookup
  NAMES_VERSION: string
}

export function createJob(loadNames: () => Promise<NamesModule>) {
  let cached: { input: string, escapes: boolean, analysis: Analysis, decoded: InspectResult['decoded'] } | null = null
  let names: NamesModule | null = null

  return async function run(request: InspectRequest): Promise<InspectReply> {
    try {
      if (!names) {
        try {
          names = await loadNames()
        } catch {
          names = null // offline before the table was ever fetched: retry next time
        }
      }
      if (!cached || cached.input !== request.input || cached.escapes !== request.escapes) {
        const decoded = request.escapes ? decodeEscapes(request.input) : null
        cached = { input: request.input, escapes: request.escapes, analysis: analyze(decoded ? decoded.text : request.input), decoded: decoded && { decoded: decoded.decoded, invalid: decoded.invalid } }
      }
      const { analysis } = cached
      const lookup = names?.nameOf ?? null
      const label = (cp: number) => {
        const name = lookup?.(cp)?.name
        return name ? `${cpLabel(cp)} · ${name}` : cpLabel(cp)
      }
      const result: InspectResult = {
        stats: analysis.stats,
        findings: analysis.findings.map((f) => ({ ...f, labels: f.occurrences.map((o) => (o.cp === undefined ? '' : label(o.cp))) })),
        page: buildPage(analysis, request.page, lookup),
        names: { status: names ? 'ok' : 'unavailable', version: names?.NAMES_VERSION ?? null },
        decoded: cached.decoded,
      }
      if (request.view.kind === 'normalize') result.normalize = normalizeView(analysis, request.view.form)
      if (request.view.kind === 'clean') result.clean = cleanView(analysis, request.view.options, lookup)
      return { id: request.id, ok: true, result }
    } catch (error) {
      return { id: request.id, ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }
}

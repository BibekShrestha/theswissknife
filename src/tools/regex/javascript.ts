import type { CaptureSpan, MatchSpan, RegexRequest, RegexResult } from './types'

export const MAX_MATCHES = 1_000

type Indices = Array<[number, number] | undefined> & { groups?: Record<string, [number, number] | undefined> }

function supportedIndices(): boolean {
  try {
    return new RegExp('', 'd').hasIndices
  } catch {
    return false
  }
}

function capturesFor(match: RegExpExecArray): CaptureSpan[] {
  const indices = (match as RegExpExecArray & { indices?: Indices }).indices
  const namesByIndex = new Map<number, string>()
  if (indices?.groups) {
    for (const [name, range] of Object.entries(indices.groups)) {
      if (!range) continue
      const index = indices.findIndex((candidate, candidateIndex) => candidateIndex > 0 && candidate?.[0] === range[0] && candidate?.[1] === range[1])
      if (index > 0 && !namesByIndex.has(index)) namesByIndex.set(index, name)
    }
  }
  return match.slice(1).map((text, offset) => {
    const index = offset + 1
    const range = indices?.[index]
    return {
      index,
      name: namesByIndex.get(index),
      text: text ?? null,
      start: range?.[0] ?? null,
      end: range?.[1] ?? null,
    }
  })
}

function advanceStringIndex(subject: string, index: number, unicode: boolean): number {
  if (!unicode || index >= subject.length - 1) return index + 1
  const first = subject.charCodeAt(index)
  if (first < 0xd800 || first > 0xdbff) return index + 1
  const second = subject.charCodeAt(index + 1)
  return second >= 0xdc00 && second <= 0xdfff ? index + 2 : index + 1
}

export function evaluateJavascript(request: RegexRequest): RegexResult {
  const started = performance.now()
  const flags = request.flags.replace(/x/g, '')
  try {
    const hasGlobal = flags.includes('g')
    const executionFlags = `${flags.replace(/g/g, '').replace(/d/g, '')}${supportedIndices() ? 'd' : ''}${hasGlobal ? 'g' : ''}`
    const regex = new RegExp(request.pattern, executionFlags)
    const matches: MatchSpan[] = []
    let match: RegExpExecArray | null
    while ((match = regex.exec(request.subject)) !== null) {
      const range = (match as RegExpExecArray & { indices?: Indices }).indices?.[0]
      const start = range?.[0] ?? match.index
      const end = range?.[1] ?? match.index + match[0].length
      matches.push({ start, end, text: match[0], captures: capturesFor(match) })
      if (!hasGlobal || matches.length >= MAX_MATCHES) break
      if (match[0].length === 0) regex.lastIndex = advanceStringIndex(request.subject, regex.lastIndex, flags.includes('u'))
    }
    const replacement = request.operation === 'replace' ? request.subject.replace(new RegExp(request.pattern, executionFlags), request.replacement) : null
    return {
      engine: 'javascript',
      version: 'ECMAScript',
      matches,
      replacement,
      elapsedMs: performance.now() - started,
      error: null,
      truncated: hasGlobal && matches.length === MAX_MATCHES,
    }
  } catch (error) {
    return {
      engine: 'javascript', version: 'ECMAScript', matches: [], replacement: null,
      elapsedMs: performance.now() - started,
      error: error instanceof Error ? error.message : String(error), truncated: false,
    }
  }
}

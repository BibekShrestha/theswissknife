import { parseRegex } from './syntax/parser'
import type { CaptureSpan, MatchSpan, RegexRequest, RegexResult, TestCase, TestsRequest, TestsResult } from './types'

export const MAX_MATCHES = 1_000
export const REGEX_TIMEOUT_MS = 5_000

type Indices = Array<[number, number] | undefined> & { groups?: Record<string, [number, number] | undefined> }

function supportedIndices(): boolean {
  try {
    return new RegExp('', 'd').hasIndices
  } catch {
    return false
  }
}

/**
 * Group number → name, from the parser. Reading names back from
 * `indices.groups` cannot tell two groups with the same span apart, and with
 * duplicate named groups (ES2025) one name belongs to several numbers.
 */
function groupNames(pattern: string, flags: string): Map<number, string> {
  const names = new Map<number, string>()
  const parsed = parseRegex(pattern, flags)
  if (parsed.ok) for (const group of parsed.pattern.groups) if (group.name) names.set(group.index, group.name)
  return names
}

function capturesFor(match: RegExpExecArray, names: Map<number, string>): CaptureSpan[] {
  const indices = (match as RegExpExecArray & { indices?: Indices }).indices
  return match.slice(1).map((text, offset) => {
    const index = offset + 1
    const range = indices?.[index]
    return {
      index,
      name: names.get(index),
      text: text ?? null,
      start: range?.[0] ?? null,
      end: range?.[1] ?? null,
    }
  })
}

/** AdvanceStringIndex from the spec: past a whole surrogate pair in u/v mode. */
export function advanceStringIndex(subject: string, index: number, unicode: boolean): number {
  if (!unicode || index + 1 >= subject.length) return index + 1
  const first = subject.charCodeAt(index)
  if (first < 0xd800 || first > 0xdbff) return index + 1
  const second = subject.charCodeAt(index + 1)
  return second >= 0xdc00 && second <= 0xdfff ? index + 2 : index + 1
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Evaluate a regex request synchronously. Only ever called inside
 * regex.worker.ts, whose runner terminates it on a deadline — a pattern that
 * backtracks catastrophically cannot be interrupted any other way.
 *
 * Matching follows String.prototype.matchAll: with g every match from
 * lastIndex 0; with y each match must start exactly where the last ended
 * (so gy stops at the first gap); without g only the first; and an empty
 * match advances lastIndex by one code unit, or one code point with u/v.
 */
export function evaluateJavascript(request: RegexRequest): RegexResult {
  const started = performance.now()
  const flags = request.flags
  try {
    const hasGlobal = flags.includes('g')
    const unicode = flags.includes('u') || flags.includes('v')
    const executionFlags = `${flags.replace(/[gd]/g, '')}${supportedIndices() ? 'd' : ''}${hasGlobal ? 'g' : ''}`
    const regex = new RegExp(request.pattern, executionFlags)
    const names = groupNames(request.pattern, flags)
    const matches: MatchSpan[] = []
    let truncated = false
    let match: RegExpExecArray | null
    while ((match = regex.exec(request.subject)) !== null) {
      if (matches.length >= MAX_MATCHES) {
        truncated = true
        break
      }
      const range = (match as RegExpExecArray & { indices?: Indices }).indices?.[0]
      const start = range?.[0] ?? match.index
      const end = range?.[1] ?? match.index + match[0].length
      matches.push({ start, end, text: match[0], captures: capturesFor(match, names) })
      if (!hasGlobal) break
      if (match[0].length === 0) regex.lastIndex = advanceStringIndex(request.subject, regex.lastIndex, unicode)
    }
    const replacement = request.operation === 'replace' ? request.subject.replace(new RegExp(request.pattern, flags.replace(/d/g, '')), request.replacement) : null
    return {
      engine: 'javascript',
      version: 'ECMAScript',
      matches,
      replacement,
      elapsedMs: performance.now() - started,
      error: null,
      truncated,
    }
  } catch (error) {
    return {
      engine: 'javascript', version: 'ECMAScript', matches: [], replacement: null,
      elapsedMs: performance.now() - started,
      error: errorText(error), truncated: false,
    }
  }
}

/**
 * Run the Tests tab's cases. Each line is matched on its own from index 0,
 * as RegExp.prototype.exec would with lastIndex 0: g makes no difference, y
 * anchors the match at the start of the line. "Full match" asks for one match
 * spanning the whole line, found with the pattern wrapped as
 * `(?:pattern)(?![\s\S])` under y — group numbers and names are unchanged,
 * and `(?![\s\S])` means end of input whatever the m flag says.
 */
export function evaluateTests(request: Pick<TestsRequest, 'pattern' | 'flags' | 'cases'>): TestsResult {
  const started = performance.now()
  try {
    const base = request.flags.replace(/[gd]/g, '')
    const anywhere = new RegExp(request.pattern, base)
    const whole = new RegExp(`(?:${request.pattern})(?![\\s\\S])`, base.includes('y') ? base : `${base}y`)
    const results = request.cases.map((testCase: TestCase) => {
      anywhere.lastIndex = 0
      const found = anywhere.exec(testCase.text)
      let matched = found !== null
      if (testCase.full) {
        whole.lastIndex = 0
        matched = whole.test(testCase.text)
      }
      return {
        pass: testCase.expect === 'match' ? matched : !matched,
        matched,
        match: found ? { start: found.index, end: found.index + found[0].length, text: found[0] } : null,
      }
    })
    return { results, elapsedMs: performance.now() - started, error: null }
  } catch (error) {
    return { results: [], elapsedMs: performance.now() - started, error: errorText(error) }
  }
}

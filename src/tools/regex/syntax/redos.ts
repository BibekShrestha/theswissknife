/**
 * Spots the shapes behind most catastrophic backtracking, from the parse tree,
 * before anything runs. It is a warning, not a guard: the worker's deadline is
 * what keeps the tab alive. Two shapes are reported:
 *
 * 1. A repetition whose every iteration can be just another unbounded
 *    repetition — (a+)+, (\w+\s?)*, (a*b*)* — so a failing input can be split
 *    between the two in exponentially many ways.
 * 2. A repetition over alternatives that can match the same character —
 *    (a|a)*, (\w|\d)+, (.|\s)* — which multiplies the same way.
 *
 * Bounded overlap such as \d+\d+ (polynomial, not exponential) and
 * look-around-only tricks are not reported.
 */

import type { ClassItem, Node, ParsedPattern, Quantifier } from './ast'

export interface BacktrackWarning {
  message: string
  start: number
  end: number
}

function nullable(n: Node): boolean {
  switch (n.type) {
    case 'quantifier':
      return n.min === 0 || nullable(n.body)
    case 'group':
      return n.kind.includes('look') || nullable(n.body)
    case 'disjunction':
      return n.alternatives.some(nullable)
    case 'sequence':
      return n.items.every(nullable)
    case 'anchor':
    case 'backreference':
      return true
    default:
      return false
  }
}

/** The unbounded repetition an iteration can consist of, if there is one. */
function soleRepeat(n: Node): Quantifier | null {
  switch (n.type) {
    case 'quantifier':
      return n.max === Infinity ? n : null
    case 'group':
      return n.kind.includes('look') ? null : soleRepeat(n.body)
    case 'disjunction':
      for (const alt of n.alternatives) {
        const found = soleRepeat(alt)
        if (found) return found
      }
      return null
    case 'sequence': {
      const required = n.items.filter((item) => !nullable(item))
      if (required.length === 1) return soleRepeat(required[0])
      if (required.length === 0) {
        for (const item of n.items) {
          const found = soleRepeat(item)
          if (found) return found
        }
      }
      return null
    }
    default:
      return null
  }
}

const SAMPLE: number[] = [
  ...Array.from({ length: 128 }, (_, i) => i),
  0xa0, 0xe9, 0xc9, 0x3b1, 0x416, 0x2028, 0x3000, 0x4e00, 0xfeff, 0x1f600,
]

type Matcher = (cp: number) => boolean

const LINE_TERMINATORS = new Set([0x0a, 0x0d, 0x2028, 0x2029])
const ESCAPES: Record<string, RegExp> = { d: /\d/u, D: /\D/u, s: /\s/u, S: /\S/u, w: /\w/u, W: /\W/u }

function propertyMatcher(name: string | undefined, value: string, negated: boolean): Matcher | null {
  try {
    const re = new RegExp(`^\\${negated ? 'P' : 'p'}{${name ? `${name}=` : ''}${value}}$`, 'u')
    return (cp) => re.test(String.fromCodePoint(cp))
  } catch {
    return null
  }
}

function itemMatcher(item: ClassItem | Node, fold: boolean, dotAll: boolean): Matcher | null {
  const f = (cp: number) => (fold ? String.fromCodePoint(cp).toLowerCase().codePointAt(0)! : cp)
  switch (item.type) {
    case 'char': {
      const target = f(item.value)
      return (cp) => f(cp) === target
    }
    case 'range': {
      const { value: lo } = item.from
      const { value: hi } = item.to
      return (cp) => (cp >= lo && cp <= hi) || (fold && [cp, f(cp), String.fromCodePoint(cp).toUpperCase().codePointAt(0)!].some((c) => c >= lo && c <= hi))
    }
    case 'dot':
      return (cp) => dotAll || !LINE_TERMINATORS.has(cp)
    case 'class-escape': {
      const re = ESCAPES[item.kind]
      return (cp) => re.test(String.fromCodePoint(cp))
    }
    case 'property':
      return item.strings ? null : propertyMatcher(item.name, item.value, item.negated)
    case 'class': {
      if (item.op !== 'union') return null
      const parts = item.items.map((child) => itemMatcher(child, fold, dotAll))
      if (parts.some((part) => part === null)) return null
      const union = (cp: number) => parts.some((part) => part!(cp))
      return item.negated ? (cp) => !union(cp) : union
    }
    case 'group':
      if (item.kind.includes('look')) return null
      return itemMatcher(item.body, fold, dotAll)
    case 'disjunction':
      return item.alternatives.length === 1 ? itemMatcher(item.alternatives[0], fold, dotAll) : null
    case 'sequence':
      return item.items.length === 1 ? itemMatcher(item.items[0], fold, dotAll) : null
    default:
      return null
  }
}

function overlappingAlternatives(n: Node, fold: boolean, dotAll: boolean): [Node, Node] | null {
  if (n.type === 'group') return n.kind.includes('look') ? null : overlappingAlternatives(n.body, fold, dotAll)
  if (n.type === 'sequence') return n.items.length === 1 ? overlappingAlternatives(n.items[0], fold, dotAll) : null
  if (n.type !== 'disjunction' || n.alternatives.length < 2) return null
  const matchers = n.alternatives.map((alt) => itemMatcher(alt, fold, dotAll))
  for (let i = 0; i < matchers.length; i++) {
    for (let j = i + 1; j < matchers.length; j++) {
      const a = matchers[i]
      const b = matchers[j]
      if (a && b && SAMPLE.some((cp) => a(cp) && b(cp))) return [n.alternatives[i], n.alternatives[j]]
    }
  }
  return null
}

export function findBacktrackRisks(pattern: string, parsed: ParsedPattern, flags: string): BacktrackWarning[] {
  const warnings: BacktrackWarning[] = []
  const text = (n: { start: number; end: number }) => pattern.slice(n.start, n.end)
  const fold = flags.includes('i')
  const dotAll = flags.includes('s')

  const visit = (n: Node | ClassItem) => {
    switch (n.type) {
      case 'quantifier': {
        if (n.max === Infinity || n.max >= 10) {
          const inner = soleRepeat(n.body)
          const overlap = inner ? null : overlappingAlternatives(n.body, fold, dotAll)
          if (inner) {
            warnings.push({
              start: n.start,
              end: n.end,
              message: `Nested quantifiers: "${text(inner)}" repeats inside "${text(n)}". When the rest of the pattern fails, the engine can try exponentially many ways to split the input between them.`,
            })
            visit(n.body)
            return
          }
          if (overlap) {
            warnings.push({
              start: n.start,
              end: n.end,
              message: `Overlapping alternatives: "${text(overlap[0])}" and "${text(overlap[1])}" can match the same character inside the repetition "${text(n)}", so a failing input can be tried in exponentially many combinations.`,
            })
          }
        }
        visit(n.body)
        return
      }
      case 'group':
        visit(n.body)
        return
      case 'disjunction':
        n.alternatives.forEach(visit)
        return
      case 'sequence':
        n.items.forEach(visit)
        return
      default:
        return
    }
  }
  visit(parsed.ast)
  return warnings
}

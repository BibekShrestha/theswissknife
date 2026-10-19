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
 *
 * It runs on the main thread on every keystroke, so it is linear in the size
 * of the pattern and capped by WORK_BUDGET: a pattern too large to check in
 * time is reported as skipped rather than analysed slowly.
 */

import type { ClassItem, Node, ParsedPattern, Quantifier } from './ast'

export interface BacktrackWarning {
  message: string
  start: number
  end: number
}

function nullable(n: Node, budget: Budget): boolean {
  spend(budget, 1)
  switch (n.type) {
    case 'quantifier':
      return n.min === 0 || nullable(n.body, budget)
    case 'group':
      return n.kind.includes('look') || nullable(n.body, budget)
    case 'disjunction':
      return n.alternatives.some((alt) => nullable(alt, budget))
    case 'sequence':
      return n.items.every((item) => nullable(item, budget))
    case 'anchor':
    case 'backreference':
      return true
    default:
      return false
  }
}

/** The unbounded repetition an iteration can consist of, if there is one. */
function soleRepeat(n: Node, budget: Budget): Quantifier | null {
  spend(budget, 1)
  switch (n.type) {
    case 'quantifier':
      return n.max === Infinity ? n : null
    case 'group':
      return n.kind.includes('look') ? null : soleRepeat(n.body, budget)
    case 'disjunction':
      for (const alt of n.alternatives) {
        const found = soleRepeat(alt, budget)
        if (found) return found
      }
      return null
    case 'sequence': {
      const required = n.items.filter((item) => !nullable(item, budget))
      if (required.length === 1) return soleRepeat(required[0], budget)
      if (required.length === 0) {
        for (const item of n.items) {
          const found = soleRepeat(item, budget)
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
const LOWER = SAMPLE.map((cp) => String.fromCodePoint(cp).toLowerCase().codePointAt(0)!)
const UPPER = SAMPLE.map((cp) => String.fromCodePoint(cp).toUpperCase().codePointAt(0)!)

/**
 * The analysis must never stall the main thread, whatever is typed or arrives
 * in a link. Each node visited and each sample code point tested costs one
 * unit; past the budget the check gives up and says so. A few million units
 * run in well under 50 ms.
 */
export const WORK_BUDGET = 2_000_000

class OverBudget extends Error {}

/**
 * Which of the SAMPLE code points an item matches, one bit each. Computing a
 * mask per alternative once and intersecting masks keeps the overlap check
 * linear in the number of alternatives — testing every pair of alternatives
 * against every sample took seconds on a few thousand alternatives.
 */
type Mask = Uint32Array
const WORDS = Math.ceil(SAMPLE.length / 32)

interface Budget {
  work: number
}

function spend(budget: Budget, units: number) {
  budget.work += units
  if (budget.work > WORK_BUDGET) throw new OverBudget()
}

function maskWhere(budget: Budget, test: (i: number) => boolean): Mask {
  spend(budget, SAMPLE.length)
  const mask = new Uint32Array(WORDS)
  for (let i = 0; i < SAMPLE.length; i++) if (test(i)) mask[i >>> 5] |= 1 << (i & 31)
  return mask
}

const LINE_TERMINATORS = new Set([0x0a, 0x0d, 0x2028, 0x2029])
const ESCAPES: Record<string, RegExp> = { d: /\d/u, D: /\D/u, s: /\s/u, S: /\S/u, w: /\w/u, W: /\W/u }

function propertyTest(name: string | undefined, value: string, negated: boolean): ((i: number) => boolean) | null {
  try {
    const re = new RegExp(`^\\${negated ? 'P' : 'p'}{${name ? `${name}=` : ''}${value}}$`, 'u')
    return (i) => re.test(String.fromCodePoint(SAMPLE[i]))
  } catch {
    return null
  }
}

interface MaskContext {
  fold: boolean
  dotAll: boolean
  budget: Budget
  /** Escapes and properties repeat; each distinct one is tested once. */
  cache: Map<string, Mask | null>
}

function cached(ctx: MaskContext, key: string, build: () => Mask | null): Mask | null {
  if (ctx.cache.has(key)) return ctx.cache.get(key)!
  const mask = build()
  ctx.cache.set(key, mask)
  return mask
}

function itemMask(item: ClassItem | Node, ctx: MaskContext): Mask | null {
  const { fold, dotAll, budget } = ctx
  spend(budget, 1)
  switch (item.type) {
    case 'char': {
      const target = fold ? String.fromCodePoint(item.value).toLowerCase().codePointAt(0)! : item.value
      return maskWhere(budget, (i) => (fold ? LOWER[i] : SAMPLE[i]) === target)
    }
    case 'range': {
      const { value: lo } = item.from
      const { value: hi } = item.to
      const inside = (cp: number) => cp >= lo && cp <= hi
      return maskWhere(budget, (i) => inside(SAMPLE[i]) || (fold && (inside(LOWER[i]) || inside(UPPER[i]))))
    }
    case 'dot':
      return cached(ctx, 'dot', () => maskWhere(budget, (i) => dotAll || !LINE_TERMINATORS.has(SAMPLE[i])))
    case 'class-escape': {
      const re = ESCAPES[item.kind]
      return cached(ctx, `\\${item.kind}`, () => maskWhere(budget, (i) => re.test(String.fromCodePoint(SAMPLE[i]))))
    }
    case 'property': {
      if (item.strings) return null
      return cached(ctx, `p${item.negated ? '!' : ''}${item.name ?? ''}=${item.value}`, () => {
        const test = propertyTest(item.name, item.value, item.negated)
        return test ? maskWhere(budget, test) : null
      })
    }
    case 'class': {
      if (item.op !== 'union') return null
      const union = new Uint32Array(WORDS)
      for (const child of item.items) {
        const part = itemMask(child, ctx)
        if (part === null) return null
        spend(budget, WORDS)
        for (let w = 0; w < WORDS; w++) union[w] |= part[w]
      }
      if (!item.negated) return union
      // only the bits that stand for a sample, or two negated classes would
      // "overlap" on padding
      return maskWhere(budget, (i) => (union[i >>> 5] & (1 << (i & 31))) === 0)
    }
    case 'group':
      if (item.kind.includes('look')) return null
      return itemMask(item.body, ctx)
    case 'disjunction':
      return item.alternatives.length === 1 ? itemMask(item.alternatives[0], ctx) : null
    case 'sequence':
      return item.items.length === 1 ? itemMask(item.items[0], ctx) : null
    default:
      return null
  }
}

function intersects(a: Mask, b: Mask): boolean {
  for (let w = 0; w < WORDS; w++) if (a[w] & b[w]) return true
  return false
}

function overlappingAlternatives(n: Node, ctx: MaskContext): [Node, Node] | null {
  spend(ctx.budget, 1)
  if (n.type === 'group') return n.kind.includes('look') ? null : overlappingAlternatives(n.body, ctx)
  if (n.type === 'sequence') return n.items.length === 1 ? overlappingAlternatives(n.items[0], ctx) : null
  if (n.type !== 'disjunction' || n.alternatives.length < 2) return null
  const masks: (Mask | null)[] = []
  const seen = new Uint32Array(WORDS) // union of every earlier alternative
  for (let j = 0; j < n.alternatives.length; j++) {
    const mask = itemMask(n.alternatives[j], ctx)
    masks.push(mask)
    if (!mask) continue
    spend(ctx.budget, WORDS)
    if (intersects(mask, seen)) {
      // some earlier alternative shares a character: find which, once
      for (let i = 0; i < j; i++) {
        spend(ctx.budget, WORDS)
        const other = masks[i]
        if (other && intersects(mask, other)) return [n.alternatives[i], n.alternatives[j]]
      }
    }
    for (let w = 0; w < WORDS; w++) seen[w] |= mask[w]
  }
  return null
}

export interface BacktrackAnalysis {
  risks: BacktrackWarning[]
  /** True when the pattern was too large to check within WORK_BUDGET. */
  skipped: boolean
  /** Units of work spent, for tests: never more than WORK_BUDGET + a node. */
  work: number
}

export function findBacktrackRisks(pattern: string, parsed: ParsedPattern, flags: string): BacktrackWarning[] {
  return analyzeBacktracking(pattern, parsed, flags).risks
}

export function analyzeBacktracking(pattern: string, parsed: ParsedPattern, flags: string): BacktrackAnalysis {
  const warnings: BacktrackWarning[] = []
  const text = (n: { start: number; end: number }) => pattern.slice(n.start, n.end)
  const budget: Budget = { work: 0 }
  const ctx: MaskContext = { fold: flags.includes('i'), dotAll: flags.includes('s'), budget, cache: new Map() }

  const visit = (n: Node | ClassItem) => {
    spend(budget, 1)
    switch (n.type) {
      case 'quantifier': {
        if (n.max === Infinity || n.max >= 10) {
          const inner = soleRepeat(n.body, budget)
          const overlap = inner ? null : overlappingAlternatives(n.body, ctx)
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
  try {
    visit(parsed.ast)
  } catch (error) {
    if (!(error instanceof OverBudget)) throw error
    return { risks: [], skipped: true, work: budget.work }
  }
  return { risks: warnings, skipped: false, work: budget.work }
}

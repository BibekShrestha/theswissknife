/**
 * Type names from JSON keys: PascalCase, singular for array items, never a
 * name that shadows something the generated code itself needs.
 */

/**
 * Names the generated code imports or leans on in one of the targets
 * (TS globals, Zod's `z`, Python's typing / pydantic imports, Go's predeclared
 * `any`), plus globals a reader would not expect to see redefined. A type that
 * would take one of these gets a `Type` suffix instead.
 */
const RESERVED = new Set([
  'Array', 'Boolean', 'Date', 'Error', 'Function', 'JSON', 'Map', 'Math', 'Number', 'Object', 'Partial', 'Promise',
  'Readonly', 'ReadonlyArray', 'Record', 'Required', 'Set', 'String', 'Symbol', 'BigInt', 'Infinity', 'NaN',
  'Any', 'BaseModel', 'Dict', 'Field', 'List', 'Literal', 'None', 'NotRequired', 'Optional', 'RootModel', 'TypedDict',
  'UUID', 'Union', 'True', 'False',
])

/** Splits `user_profile`, `userProfile`, `user-profile`, `HTTPServer2` into words. */
export function words(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
}

/** `user_profile` → `UserProfile`. ASCII only; returns '' when nothing usable is left. */
export function pascal(text: string): string {
  return words(text).map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase()).join('')
}

const IRREGULAR: Record<string, string> = {
  people: 'person', children: 'child', men: 'man', women: 'woman', mice: 'mouse', geese: 'goose', teeth: 'tooth',
  feet: 'foot', indices: 'index', matrices: 'matrix', vertices: 'vertex', criteria: 'criterion', analyses: 'analysis',
  statuses: 'status', aliases: 'alias', buses: 'bus', bonuses: 'bonus', viruses: 'virus', campuses: 'campus',
  movies: 'movie', cookies: 'cookie', caches: 'cache', niches: 'niche', avalanches: 'avalanche', leaves: 'leaf',
  lives: 'life', knives: 'knife', wolves: 'wolf', halves: 'half', shelves: 'shelf',
}

/** Words whose singular is not obtained by dropping an s, so they get `Item` instead. */
const KEEP = new Set(['data', 'news', 'series', 'species', 'status', 'alias', 'bus', 'gas', 'lens', 'canvas', 'bonus', 'campus', 'virus', 'corpus', 'census', 'radius', 'focus', 'axis', 'analysis', 'basis', 'thesis', 'process', 'access', 'address', 'class', 'glass', 'pass', 'boss', 'chess', 'success', 'progress', 'business', 'metadata', 'info', 'stats'])

/**
 * Singular of the last word of a PascalCase name: `Categories` → `Category`,
 * `Addresses` → `Address`, `Boxes` → `Box`, `Users` → `User`. When the last word
 * isn't a recognisable plural (`Data`, `Status`, `Root`) the name gets `Item`.
 */
export function singular(name: string): string {
  const match = /([A-Z][a-z0-9]*|[0-9]+)$/.exec(name)
  const last = match ? match[1] : name
  const head = name.slice(0, name.length - last.length)
  const lower = last.toLowerCase()
  const cap = (word: string) => (word ? word[0].toUpperCase() + word.slice(1) : word)
  if (IRREGULAR[lower]) return head + cap(IRREGULAR[lower])
  if (KEEP.has(lower) || lower.length < 3 || !lower.endsWith('s') || /(ss|us|is)$/.test(lower)) return `${name}Item`
  if (/[^aeiou]ies$/.test(lower)) return head + cap(lower.slice(0, -3) + 'y')
  if (/(xes|zes|ches|shes|sses)$/.test(lower)) return head + cap(lower.slice(0, -2))
  return head + cap(lower.slice(0, -1))
}

/** PascalCase from a key; `fallback` covers keys with no ASCII letters or a leading digit. */
export function pascalOr(hint: string, fallback: string): string {
  const name = pascal(hint)
  if (!name) return fallback
  return /^[0-9]/.test(name) ? fallback + name : name
}

/** A type name from a key, never one of the reserved names. */
export function typeName(hint: string, fallback: string): string {
  const name = pascalOr(hint, fallback)
  return RESERVED.has(name) ? `${name}Type` : name
}

/** Root name typed by the user, made into an identifier every target accepts. */
export function rootTypeName(input: string): string {
  const name = /^[A-Za-z][A-Za-z0-9]*$/.test(input) ? input[0].toUpperCase() + input.slice(1) : pascal(input)
  if (!name || /^[0-9]/.test(name)) return 'Root'
  return RESERVED.has(name) ? `${name}Type` : name
}

/** Hands out unique names; identical shapes asking for the same name share it. */
export class NameTable {
  private readonly taken = new Map<string, string>()

  reserve(name: string, signature: string) {
    this.taken.set(name, signature)
  }

  /** Tries `base`, then `parent + base`, then `base2`, `base3`… */
  allocate(base: string, parent: string, signature: string): { name: string; reused: boolean } {
    const candidates = [base]
    if (parent && !base.startsWith(parent)) candidates.push(parent + base)
    for (const candidate of candidates) {
      const existing = this.taken.get(candidate)
      if (existing === undefined) {
        this.taken.set(candidate, signature)
        return { name: candidate, reused: false }
      }
      if (existing === signature) return { name: candidate, reused: true }
    }
    for (let n = 2; ; n++) {
      const candidate = `${base}${n}`
      const existing = this.taken.get(candidate)
      if (existing === undefined) {
        this.taken.set(candidate, signature)
        return { name: candidate, reused: false }
      }
      if (existing === signature) return { name: candidate, reused: true }
    }
  }
}

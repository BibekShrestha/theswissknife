/**
 * Shape → a small type model every emitter shares: named object
 * declarations plus a type expression per field. Decisions made here:
 *
 * - a key missing from some objects at its position is optional;
 * - null seen at a position makes it nullable;
 * - several JSON types at one position make a union (integers and floats
 *   together are one `number`);
 * - every object at a position — array items, the same key across samples —
 *   is one declaration, named from its key (singular for array items),
 *   de-duplicated, and shared when an identical shape asks for the same name;
 * - formats and enums only when switched on, and listed either way.
 */

import { FORMATS, MAX_DEPTH, type Format, type Shape, type StringStats } from './infer'
import { NameTable, pascalOr, rootTypeName, singular, typeName } from './naming'

export type Member =
  | { kind: 'string'; format?: Format; enum?: string[] }
  | { kind: 'number'; integer: boolean; big: boolean }
  | { kind: 'boolean' }
  | { kind: 'array'; item: Ty }
  | { kind: 'object'; ref: string }

/**
 * A type: the union of `members`, plus null when `nullable`. No members and
 * not nullable means unknown — nothing was seen (only empty arrays) or the
 * position was past the depth cap (`deep`).
 */
export interface Ty {
  members: Member[]
  nullable: boolean
  deep?: boolean
}

export interface Field {
  key: string
  type: Ty
  optional: boolean
}

export interface Decl {
  name: string
  fields: Field[]
  /** Pre-order position, for emitters that list the root first. */
  order: number
}

export interface Model {
  rootName: string
  root: Ty
  /** Post-order: every declaration comes after the ones it uses. */
  decls: Decl[]
  findings: Findings
}

export interface ModelOptions {
  rootName: string
  formats: boolean
  enums: boolean
  /** Most distinct values a string position may take to become an enum. */
  enumMax: number
}

export interface Findings {
  formats: { path: string; format: Format }[]
  enums: { path: string; values: string[] }[]
  bigs: string[]
  deep: string[]
  nullOnly: string[]
  emptyOnly: string[]
  unions: string[]
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export function childPath(path: string, key: string): string {
  return IDENT.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`
}

function stringMember(stats: StringStats, path: string, options: ModelOptions, findings: Findings): Member {
  const format = FORMATS.find((candidate) => stats.formats[candidate] === stats.count)
  if (format) {
    findings.formats.push({ path, format })
    if (options.formats) return { kind: 'string', format }
  }
  const values = stats.values
  // Low cardinality: few distinct values, each seen twice on average — a name field over three records is not an enum.
  if (values && values.size <= options.enumMax && stats.count >= 2 * values.size && !(format && options.formats)) {
    const list = [...values.keys()]
    findings.enums.push({ path, values: list })
    if (options.enums) return { kind: 'string', enum: list }
  }
  return { kind: 'string' }
}

/** Canonical text of a type, for spotting identical declarations. */
function key(ty: Ty): string {
  const parts = ty.members.map((member) => {
    switch (member.kind) {
      case 'string':
        return member.format ? `s:${member.format}` : member.enum ? `e:${JSON.stringify(member.enum)}` : 's'
      case 'number':
        return `n:${member.integer ? 'i' : 'f'}${member.big ? 'b' : ''}`
      case 'boolean':
        return 'b'
      case 'array':
        return `a(${key(member.item)})`
      case 'object':
        return `o:${member.ref}`
    }
  })
  return `${parts.join('|')}${ty.nullable ? '?' : ''}${ty.deep ? '!' : ''}`
}

export function buildModel(shape: Shape, options: ModelOptions): Model {
  const rootName = rootTypeName(options.rootName)
  const names = new NameTable()
  names.reserve(rootName, '#root')
  const decls: Decl[] = []
  const findings: Findings = { formats: [], enums: [], bigs: [], deep: [], nullOnly: [], emptyOnly: [], unions: [] }
  let order = 0

  /**
   * `hint` names an object found here (a key, or an already-singular item name
   * when `item`); `parent` is the enclosing declaration's name, for de-duplication.
   */
  function toTy(node: Shape, hint: string, parent: string, path: string, isRoot: boolean, item = false): Ty {
    if (node.deep) {
      findings.deep.push(path)
      return { members: [], nullable: false, deep: true }
    }
    const members: Member[] = []
    if (node.strings) members.push(stringMember(node.strings, path, options, findings))
    if (node.ints || node.bigs || node.floats) {
      members.push({ kind: 'number', integer: !node.floats, big: node.bigs > 0 })
      if (node.bigs) findings.bigs.push(path)
    }
    if (node.bools) members.push({ kind: 'boolean' })
    if (node.arrays) {
      // Arrays of arrays keep the item name: [[{…}]] under `rows` is Row, not RowItem.
      const itemHint = item ? hint : singular(pascalOr(hint, parent || rootName))
      const itemTy = toTy(node.arrays.item, itemHint, parent, `${path}[]`, false, true)
      if (node.arrays.item.seen === 0) findings.emptyOnly.push(path)
      members.push({ kind: 'array', item: itemTy })
    }
    if (node.objects) {
      const slot = order++
      const fields: Field[] = []
      // An object in a root that is also something else (an array, a string…) can't take the root's name.
      const own = isRoot ? rootName : path === '$' ? `${rootName}Object` : typeName(hint, parent || rootName)
      for (const [fieldKey, child] of node.objects.fields) {
        fields.push({
          key: fieldKey,
          type: toTy(child, fieldKey, own, childPath(path, fieldKey), false),
          optional: child.seen < node.objects.count,
        })
      }
      const signature = fields.map((field) => `${JSON.stringify(field.key)}${field.optional ? '?' : ''}:${key(field.type)}`).join(',')
      let name = rootName
      let reused = false
      if (!isRoot) ({ name, reused } = names.allocate(own, parent, signature))
      if (!reused) decls.push({ name, fields, order: slot })
      members.push({ kind: 'object', ref: name })
    }
    if (members.length > 1) findings.unions.push(path)
    if (!members.length && node.nulls) findings.nullOnly.push(path)
    return { members, nullable: node.nulls > 0 }
  }

  // The root only gets the root name when it is a plain object; otherwise an alias holds it and objects inside are named from it.
  const rootIsObject = Boolean(shape.objects) && !shape.nulls && !shape.strings && !shape.arrays && !shape.bools && !shape.ints && !shape.bigs && !shape.floats && !shape.deep
  const root = toTy(shape, rootName, '', '$', rootIsObject)
  return { rootName, root, decls, findings }
}

/** The declaration the root type is, when the root is a single object. */
export function rootDecl(model: Model): Decl | undefined {
  const { root } = model
  if (root.nullable || root.members.length !== 1 || root.members[0].kind !== 'object') return undefined
  const ref = root.members[0].ref
  return ref === model.rootName ? model.decls.find((decl) => decl.name === ref) : undefined
}

/** Declarations root-first (pre-order), for targets where order is free. */
export function readingOrder(model: Model): Decl[] {
  return [...model.decls].sort((a, b) => a.order - b.order)
}

/** What a field's comment should say: formats and big integers anywhere in its type (not through refs). */
export function annotations(ty: Ty): string[] {
  const out = new Set<string>()
  const visit = (t: Ty) => {
    if (t.deep) out.add(`nested deeper than ${MAX_DEPTH} levels — not inferred`)
    for (const member of t.members) {
      if (member.kind === 'string' && member.format) out.add(`format: ${member.format}`)
      if (member.kind === 'number' && member.big) out.add('integers past 2^53 seen — JSON.parse rounds them')
      if (member.kind === 'array') visit(member.item)
    }
  }
  visit(ty)
  return [...out]
}

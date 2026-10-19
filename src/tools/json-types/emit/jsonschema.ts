import { MAX_DEPTH } from '../infer'
import { rootDecl, readingOrder, type Decl, type Member, type Model, type Ty } from '../model'

type Schema = Record<string, unknown>

/** Builds objects with defineProperty so a key like `__proto__` is a property, not a prototype. */
function obj(entries: [string, unknown][]): Schema {
  const out: Schema = {}
  for (const [key, value] of entries) Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true })
  return out
}

const simpleType = (m: Member): string | undefined => {
  if (m.kind === 'string' && !m.format && !m.enum) return 'string'
  if (m.kind === 'number') return m.integer ? 'integer' : 'number'
  if (m.kind === 'boolean') return 'boolean'
  return undefined
}

function memberSchema(m: Member): Schema {
  switch (m.kind) {
    case 'string':
      if (m.format) return { type: 'string', format: m.format }
      if (m.enum) return { enum: [...m.enum] }
      return { type: 'string' }
    case 'number':
      return m.big ? { type: m.integer ? 'integer' : 'number', $comment: 'integers past 2^53 seen' } : { type: m.integer ? 'integer' : 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'object':
      return { $ref: `#/$defs/${m.ref}` }
    case 'array':
      return arraySchema(m.item)
  }
}

function arraySchema(item: Ty): Schema {
  // No item seen (only empty arrays): any item is allowed.
  if (!item.members.length && !item.nullable && !item.deep) return { type: 'array' }
  return { type: 'array', items: tySchema(item) }
}

export function tySchema(ty: Ty): Schema {
  if (!ty.members.length) {
    if (ty.nullable) return { type: 'null' }
    return ty.deep ? { $comment: `nested deeper than ${MAX_DEPTH} levels — not inferred` } : {}
  }
  const simple = ty.members.map(simpleType)
  if (simple.every(Boolean) && !ty.members.some((m) => m.kind === 'number' && m.big)) {
    const types = [...simple, ...(ty.nullable ? ['null'] : [])] as string[]
    return { type: types.length === 1 ? types[0] : types }
  }
  if (ty.members.length === 1) {
    const only = memberSchema(ty.members[0])
    if (!ty.nullable) return only
    if (Array.isArray(only.enum)) return { ...only, enum: [...only.enum, null] }
    if (typeof only.type === 'string') return { ...only, type: [only.type, 'null'] }
  }
  return { anyOf: [...ty.members.map(memberSchema), ...(ty.nullable ? [{ type: 'null' }] : [])] }
}

function objectSchema(decl: Decl): Schema {
  if (!decl.fields.length) return { type: 'object', additionalProperties: false }
  const required = decl.fields.filter((field) => !field.optional).map((field) => field.key)
  return {
    type: 'object',
    properties: obj(decl.fields.map((field) => [field.key, tySchema(field.type)])),
    ...(required.length ? { required } : {}),
  }
}

export function emitJsonSchema(model: Model): string {
  const root = rootDecl(model)
  const defs = readingOrder(model).filter((decl) => decl !== root)
  const schema: Schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: model.rootName,
    ...(root ? objectSchema(root) : tySchema(model.root)),
    ...(defs.length ? { $defs: obj(defs.map((decl) => [decl.name, objectSchema(decl)])) } : {}),
  }
  return `${JSON.stringify(schema, null, 2)}\n`
}

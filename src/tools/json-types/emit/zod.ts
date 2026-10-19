import { annotations, rootDecl, type Decl, type Member, type Model, type Ty } from '../model'

/** Zod 4 calls for each format; every detector in infer.ts is a subset of what these accept. */
const FORMAT_CALL = {
  'date-time': 'z.iso.datetime({ offset: true })',
  date: 'z.iso.date()',
  uuid: 'z.uuid()',
  email: 'z.email()',
  uri: 'z.url()',
} as const

export interface ZodOptions {
  readonly: boolean
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** `__proto__` as a plain (or quoted) key in an object literal sets the prototype; a computed key defines a property. */
const zodKey = (key: string) => (key === '__proto__' ? '["__proto__"]' : IDENT.test(key) ? key : JSON.stringify(key))

function member(m: Member, options: ZodOptions): string {
  switch (m.kind) {
    case 'string':
      if (m.format) return FORMAT_CALL[m.format]
      if (m.enum) return m.enum.length === 1 ? `z.literal(${JSON.stringify(m.enum[0])})` : `z.enum([${m.enum.map((value) => JSON.stringify(value)).join(', ')}])`
      return 'z.string()'
    case 'number':
      // Zod 4's .int() only accepts safe integers, so a position that held bigger ones stays z.number().
      return m.integer && !m.big ? 'z.number().int()' : 'z.number()'
    case 'boolean':
      return 'z.boolean()'
    case 'object':
      return m.ref
    case 'array':
      return `z.array(${zodType(m.item, options)})${options.readonly ? '.readonly()' : ''}`
  }
}

export function zodType(ty: Ty, options: ZodOptions): string {
  if (!ty.members.length) return ty.nullable ? 'z.null()' : 'z.unknown()'
  const parts = ty.members.map((m) => member(m, options))
  const base = parts.length === 1 ? parts[0] : `z.union([${parts.join(', ')}])`
  return ty.nullable ? `${base}.nullable()` : base
}

function declaration(decl: Decl, options: ZodOptions): string {
  const suffix = options.readonly ? '.readonly()' : ''
  if (!decl.fields.length) return `export const ${decl.name} = z.object({}).strict()${suffix};`
  const lines = decl.fields.map((field) => {
    const notes = annotations(field.type)
    const type = zodType(field.type, options)
    return `${notes.length ? `  // ${notes.join('; ')}\n` : ''}  ${zodKey(field.key)}: ${field.optional && type !== 'z.unknown()' ? `${type}.optional()` : type},`
  })
  return `export const ${decl.name} = z.object({\n${lines.join('\n')}\n})${suffix};`
}

export function emitZod(model: Model, options: ZodOptions): string {
  const blocks = ['// Zod 4\nimport { z } from \'zod\';']
  for (const decl of model.decls) blocks.push(`${declaration(decl, options)}\nexport type ${decl.name} = z.infer<typeof ${decl.name}>;`)
  const root = model.root
  if (!rootDecl(model)) {
    const notes = annotations(root)
    blocks.push(`${notes.length ? `// ${notes.join('; ')}\n` : ''}export const ${model.rootName} = ${zodType(root, options)};\nexport type ${model.rootName} = z.infer<typeof ${model.rootName}>;`)
  }
  return `${blocks.join('\n\n')}\n`
}

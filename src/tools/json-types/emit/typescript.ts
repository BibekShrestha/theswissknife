import { annotations, readingOrder, rootDecl, type Decl, type Member, type Model, type Ty } from '../model'

export interface TsOptions {
  declaration: 'interface' | 'type'
  /** `key?: T`, `key?: T | undefined` (for exactOptionalPropertyTypes), or `key: T | undefined`. */
  optional: 'question' | 'question-undefined' | 'undefined'
  readonly: boolean
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export const tsKey = (key: string) => (IDENT.test(key) ? key : JSON.stringify(key))

function member(m: Member, options: TsOptions): string {
  switch (m.kind) {
    case 'string':
      return m.enum ? m.enum.map((value) => JSON.stringify(value)).join(' | ') : 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'object':
      return m.ref
    case 'array': {
      const item = tsType(m.item, options)
      return `${options.readonly ? 'readonly ' : ''}${/\s/.test(item) ? `(${item})` : item}[]`
    }
  }
}

export function tsType(ty: Ty, options: TsOptions): string {
  if (!ty.members.length) return ty.nullable ? 'null' : 'unknown'
  const parts = ty.members.map((m) => member(m, options))
  if (ty.nullable) parts.push('null')
  return parts.join(' | ')
}

function comment(notes: string[], indent: string): string {
  return notes.length ? `${indent}/** ${notes.join('; ')} */\n` : ''
}

function body(decl: Decl, options: TsOptions): string {
  if (!decl.fields.length) return '{}'
  const lines = decl.fields.map((field) => {
    let type = tsType(field.type, options)
    let mark = ''
    if (field.optional) {
      if (options.optional !== 'undefined') mark = '?'
      if (options.optional !== 'question' && type !== 'unknown') type += ' | undefined'
    }
    return `${comment(annotations(field.type), '  ')}  ${options.readonly ? 'readonly ' : ''}${tsKey(field.key)}${mark}: ${type};`
  })
  return `{\n${lines.join('\n')}\n}`
}

function declaration(decl: Decl, options: TsOptions): string {
  // An empty interface accepts any non-null value; Record<string, never> says "an object with no keys".
  if (!decl.fields.length) return `export type ${decl.name} = Record<string, never>;`
  return options.declaration === 'interface'
    ? `export interface ${decl.name} ${body(decl, options)}`
    : `export type ${decl.name} = ${body(decl, options)};`
}

export function emitTypeScript(model: Model, options: TsOptions): string {
  const blocks: string[] = []
  if (!rootDecl(model)) blocks.push(`${comment(annotations(model.root), '')}export type ${model.rootName} = ${tsType(model.root, options)};`)
  for (const decl of readingOrder(model)) blocks.push(declaration(decl, options))
  return `${blocks.join('\n\n')}\n`
}

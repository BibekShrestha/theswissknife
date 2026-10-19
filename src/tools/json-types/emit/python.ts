import { annotations, rootDecl, type Decl, type Member, type Model, type Ty } from '../model'

export type PythonFlavor = 'typeddict' | 'pydantic'

const KEYWORDS = new Set(['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield'])

/** BaseModel attributes a field must not shadow. */
const PYDANTIC_TAKEN = new Set(['copy', 'dict', 'json', 'schema', 'schema_json', 'construct', 'validate', 'parse_obj', 'parse_raw', 'parse_file', 'from_orm', 'update_forward_refs', 'fields'])

/**
 * Names the annotations use. A defaulted pydantic field binds its name in the
 * class body before later annotations are evaluated, so `list: list[str] | None = None`
 * would turn every later `list[...]` into `None[...]` — these get an alias.
 */
const ANNOTATION_NAMES = ['list', 'int', 'str', 'float', 'bool', 'dt', 'UUID', 'Literal', 'Any', 'Field', 'BaseModel', 'RootModel']

/**
 * Usable as a class-body annotation as written: an ASCII identifier, not a
 * keyword, and not `__x` (class bodies mangle those to `_Class__x`).
 */
const plainName = (key: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !KEYWORDS.has(key) && !(key.startsWith('__') && !key.endsWith('__'))

/** Python string literal: JSON's escapes are all valid Python escapes. */
const pyString = (value: string) => JSON.stringify(value)

interface Imports {
  typing: Set<string>
  datetime: boolean
  uuid: boolean
  pydantic: Set<string>
}

function member(m: Member, flavor: PythonFlavor, formats: boolean, imports: Imports): string {
  switch (m.kind) {
    case 'string':
      if (m.enum) {
        imports.typing.add('Literal')
        return `Literal[${m.enum.map(pyString).join(', ')}]`
      }
      // TypedDict describes what json.loads returns — always str. pydantic parses these three.
      if (flavor === 'pydantic' && formats && (m.format === 'date-time' || m.format === 'date')) {
        imports.datetime = true
        return m.format === 'date' ? 'dt.date' : 'dt.datetime'
      }
      if (flavor === 'pydantic' && formats && m.format === 'uuid') {
        imports.uuid = true
        return 'UUID'
      }
      return 'str'
    case 'number':
      return m.integer ? 'int' : 'float'
    case 'boolean':
      return 'bool'
    case 'object':
      return m.ref
    case 'array':
      return `list[${pyType(m.item, flavor, formats, imports)}]`
  }
}

function pyType(ty: Ty, flavor: PythonFlavor, formats: boolean, imports: Imports): string {
  if (!ty.members.length) {
    if (ty.nullable) return 'None'
    imports.typing.add('Any')
    return 'Any'
  }
  const parts = ty.members.map((m) => member(m, flavor, formats, imports))
  if (ty.nullable) parts.push('None')
  return parts.join(' | ')
}

function comment(ty: Ty): string {
  const notes = annotations(ty).filter((note) => !note.startsWith('integers past'))
  return notes.length ? `  # ${notes.join('; ')}` : ''
}

function typedDict(decl: Decl, formats: boolean, imports: Imports): string {
  imports.typing.add('TypedDict')
  const entries = decl.fields.map((field) => {
    let type = pyType(field.type, 'typeddict', formats, imports)
    if (field.optional) {
      imports.typing.add('NotRequired')
      type = `NotRequired[${type}]`
    }
    return { key: field.key, type, note: comment(field.type) }
  })
  if (!entries.length) return `class ${decl.name}(TypedDict):\n    pass`
  if (entries.every((entry) => plainName(entry.key))) {
    return `class ${decl.name}(TypedDict):\n${entries.map((entry) => `    ${entry.key}: ${entry.type}${entry.note}`).join('\n')}`
  }
  // Keys that can't be written as annotations need the functional form.
  return `${decl.name} = TypedDict(${pyString(decl.name)}, {\n${entries.map((entry) => `    ${pyString(entry.key)}: ${entry.type},${entry.note}`).join('\n')}\n})`
}

function attributeName(key: string, used: Set<string>, taken: Set<string>): string {
  let name = key.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+/, '')
  if (!name || /^[0-9]/.test(name)) name = `field_${name}`
  if (KEYWORDS.has(name) || taken.has(name) || name.startsWith('model_')) name += '_'
  let unique = name
  for (let n = 2; used.has(unique); n++) unique = `${name}_${n}`
  return unique
}

function model(decl: Decl, formats: boolean, imports: Imports, taken: Set<string>): string {
  imports.pydantic.add('BaseModel')
  if (!decl.fields.length) return `class ${decl.name}(BaseModel):\n    pass`
  const used = new Set<string>()
  for (const field of decl.fields) if (plainName(field.key) && !field.key.startsWith('_') && !taken.has(field.key) && !field.key.startsWith('model_')) used.add(field.key)
  const lines = decl.fields.map((field) => {
    let type = pyType(field.type, 'pydantic', formats, imports)
    const direct = used.has(field.key)
    const name = direct ? field.key : attributeName(field.key, used, taken)
    used.add(name)
    // pydantic can't say "may be missing but never null": a missing key becomes None.
    if (field.optional && !/(^| )None$/.test(type)) type += ' | None'
    const alias = direct ? '' : `alias=${pyString(field.key)}`
    if (alias) imports.pydantic.add('Field')
    let value = ''
    if (field.optional) value = alias ? ` = Field(default=None, ${alias})` : ' = None'
    else if (alias) value = ` = Field(${alias})`
    return `    ${name}: ${type}${value}${comment(field.type)}`
  })
  return `class ${decl.name}(BaseModel):\n${lines.join('\n')}`
}

export function emitPython(m: Model, flavor: PythonFlavor, formats: boolean): string {
  const imports: Imports = { typing: new Set(), datetime: false, uuid: false, pydantic: new Set() }
  const taken = new Set([...PYDANTIC_TAKEN, ...ANNOTATION_NAMES, ...m.decls.map((decl) => decl.name), m.rootName])
  const blocks = m.decls.map((decl) => (flavor === 'typeddict' ? typedDict(decl, formats, imports) : model(decl, formats, imports, taken)))
  if (!rootDecl(m)) {
    const type = pyType(m.root, flavor, formats, imports)
    if (flavor === 'pydantic') {
      imports.pydantic.add('RootModel')
      blocks.push(`class ${m.rootName}(RootModel[${type}]):\n    pass`)
    } else {
      blocks.push(`${m.rootName} = ${type}`)
    }
  }
  const head: string[] = []
  if (imports.datetime) head.push('import datetime as dt')
  if (imports.typing.size) head.push(`from typing import ${[...imports.typing].sort().join(', ')}`)
  if (imports.uuid) head.push('from uuid import UUID')
  if (imports.pydantic.size) head.push(`from pydantic import ${[...imports.pydantic].sort().join(', ')}`)
  const note = flavor === 'pydantic' ? '# Python 3.10+, pydantic v2' : '# Python 3.11+'
  return `${[note, ...head].join('\n')}\n\n\n${blocks.join('\n\n\n')}\n`
}

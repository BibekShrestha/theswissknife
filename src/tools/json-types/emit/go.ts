import { annotations, readingOrder, rootDecl, type Decl, type Member, type Model, type Ty } from '../model'
import { words } from '../naming'

/** Go's usual spelling for initialisms in exported names (golint's list, trimmed). */
const INITIALISMS = new Set(['ACL', 'API', 'ASCII', 'CPU', 'CSS', 'DNS', 'EOF', 'GUID', 'HTML', 'HTTP', 'HTTPS', 'ID', 'IP', 'JSON', 'LHS', 'QPS', 'RAM', 'RHS', 'RPC', 'SLA', 'SMTP', 'SQL', 'SSH', 'TCP', 'TLS', 'TTL', 'UDP', 'UI', 'UID', 'UUID', 'URI', 'URL', 'UTF8', 'VM', 'XML', 'XMPP', 'XSRF', 'XSS'])

export function goFieldName(key: string): string {
  return words(key).map((word) => (INITIALISMS.has(word.toUpperCase()) ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1).toLowerCase())).join('')
}

/** encoding/json's isValidTag: letters, digits and this punctuation only. */
const VALID_TAG = /^[\p{L}\p{N}!#$%&()*+\-./:;<=>?@[\]^_{|}~ ]+$/u

interface Imports {
  time: boolean
  json: boolean
}

interface GoType {
  text: string
  /** Already nil-able (slice, interface): no pointer needed for null or a missing key. */
  nilable: boolean
}

function describe(ty: Ty): string {
  const names = ty.members.map((m) => (m.kind === 'object' ? m.ref : m.kind === 'array' ? 'array' : m.kind))
  return [...names, ...(ty.nullable ? ['null'] : [])].join(' | ')
}

function member(m: Member, formats: boolean, imports: Imports): GoType {
  switch (m.kind) {
    case 'string':
      if (formats && m.format === 'date-time') {
        imports.time = true
        return { text: 'time.Time', nilable: false }
      }
      return { text: 'string', nilable: false }
    case 'number':
      if (m.big) {
        // json.Number keeps every digit; int64 would overflow and float64 round.
        imports.json = true
        return { text: 'json.Number', nilable: false }
      }
      return { text: m.integer ? 'int64' : 'float64', nilable: false }
    case 'boolean':
      return { text: 'bool', nilable: false }
    case 'object':
      return { text: m.ref, nilable: false }
    case 'array': {
      const item = goType(m.item, formats, imports)
      return { text: `[]${item.text}`, nilable: true }
    }
  }
}

/** The Go type for a position; null makes it a pointer unless it is already nil-able. */
function goType(ty: Ty, formats: boolean, imports: Imports): GoType {
  if (ty.members.length !== 1) return { text: 'any', nilable: true }
  const base = member(ty.members[0], formats, imports)
  return ty.nullable && !base.nilable ? { text: `*${base.text}`, nilable: true } : base
}

function struct(decl: Decl, formats: boolean, imports: Imports): string {
  if (!decl.fields.length) return `type ${decl.name} struct{}`
  const used = new Set<string>()
  const rows: { name: string; type: string; tag: string; comment: string }[] = []
  const skipped: string[] = []
  decl.fields.forEach((field, index) => {
    if (!VALID_TAG.test(field.key)) {
      skipped.push(field.key)
      return
    }
    let name = goFieldName(field.key)
    if (!name || !/^[A-Z]/.test(name)) name = `F${name || index + 1}`
    let unique = name
    for (let n = 2; used.has(unique); n++) unique = `${name}${n}`
    used.add(unique)
    let type = goType(field.type, formats, imports)
    if (field.optional && !type.nilable) type = { text: `*${type.text}`, nilable: true }
    const notes = annotations(field.type).filter((note) => formats || !note.startsWith('format'))
    if (field.type.members.length > 1) notes.unshift(describe(field.type))
    rows.push({ name: unique, type: type.text, tag: `\`json:"${field.key}${field.optional ? ',omitempty' : ''}"\``, comment: notes.length ? ` // ${notes.join('; ')}` : '' })
  })
  const nameWidth = Math.max(0, ...rows.map((row) => row.name.length))
  const typeWidth = Math.max(0, ...rows.map((row) => row.type.length))
  const lines = rows.map((row) => `\t${row.name.padEnd(nameWidth)} ${row.type.padEnd(typeWidth)} ${row.tag}${row.comment}`)
  for (const key of skipped) lines.push(`\t// ${JSON.stringify(key)} can't be written as a Go struct tag; not mapped`)
  return `type ${decl.name} struct {\n${lines.join('\n')}\n}`
}

export interface GoResult {
  code: string
  /** Keys with characters a struct tag can't hold. */
  skipped: string[]
}

export function emitGo(model: Model, formats: boolean): GoResult {
  const imports: Imports = { time: false, json: false }
  const blocks: string[] = []
  if (!rootDecl(model)) {
    const root = goType(model.root, formats, imports)
    const notes = annotations(model.root).filter((note) => formats || !note.startsWith('format'))
    if (model.root.members.length > 1) notes.unshift(describe(model.root))
    blocks.push(`${notes.length ? `// ${notes.join('; ')}\n` : ''}type ${model.rootName} ${root.text === 'any' ? '= any' : root.text}`)
  }
  const skipped: string[] = []
  for (const decl of readingOrder(model)) {
    blocks.push(struct(decl, formats, imports))
    for (const field of decl.fields) if (!VALID_TAG.test(field.key)) skipped.push(field.key)
  }
  const list = [imports.json && '"encoding/json"', imports.time && '"time"'].filter(Boolean) as string[]
  const head = ['package model', ...(list.length === 1 ? [`import ${list[0]}`] : list.length ? [`import (\n${list.map((item) => `\t${item}`).join('\n')}\n)`] : [])]
  return { code: `${[...head, ...blocks].join('\n\n')}\n`, skipped }
}

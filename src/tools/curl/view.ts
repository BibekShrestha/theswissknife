import { prettyJson, scanJson } from './json'
import { headerValue, splitPairs, type CurlRequest, type FormPart } from './parse'

/** What the parsed view shows for a body. */
export type BodyView =
  | { kind: 'json'; pretty: string }
  | { kind: 'form'; fields: { name: string; value: string }[] }
  | { kind: 'multipart'; parts: { name: string; filename?: string; type?: string; value: string; file: boolean }[] }
  | { kind: 'text'; text: string }
  | { kind: 'file'; path: string; stripNewlines: boolean }

const fromForm = (parts: FormPart[]): BodyView => ({
  kind: 'multipart',
  parts: parts.map((part) => ({
    name: part.name,
    filename: part.kind === 'file' ? part.filename ?? part.value.split(/[\\/]/).pop() : undefined,
    type: part.type,
    value: part.kind === 'text' ? part.value : `<contents of ${part.value}>`,
    file: part.kind !== 'text',
  })),
})

/** Splits a raw multipart body (Chrome and Firefox copy FormData uploads this way). */
export function splitMultipart(text: string, boundary: string): BodyView | null {
  const delimiter = `--${boundary}`
  const sections = text.split(delimiter)
  if (sections.length < 3) return null
  const parts = []
  for (const section of sections.slice(1, -1)) {
    const body = section.replace(/^\r?\n/, '')
    const split = body.search(/\r?\n\r?\n/)
    if (split < 0) continue
    const head = body.slice(0, split)
    const value = body.slice(split).replace(/^\r?\n\r?\n/, '').replace(/\r?\n$/, '')
    const name = /name="([^"]*)"/i.exec(head)?.[1] ?? ''
    const filename = /filename="([^"]*)"/i.exec(head)?.[1]
    const type = /^content-type:\s*(.+)$/im.exec(head)?.[1]?.trim()
    parts.push({ name, filename, type, value, file: filename !== undefined })
  }
  return { kind: 'multipart', parts }
}

export function describeBody(request: CurlRequest): BodyView | undefined {
  const body = request.body
  if (!body) return undefined
  if (body.kind === 'file') return { kind: 'file', path: body.path, stripNewlines: body.stripNewlines }
  if (body.kind === 'form') return fromForm(body.parts)
  const text = body.text
  const type = (headerValue(request.headers, 'content-type') ?? '').toLowerCase()
  if (/^\s*[{["]/.test(text) || type.includes('json')) {
    const tokens = scanJson(text)
    const pretty = tokens && prettyJson(text, tokens)
    if (pretty) return { kind: 'json', pretty }
  }
  const boundary = /multipart\/[^;]+;.*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(type ? headerValue(request.headers, 'content-type')! : '')
  if (boundary) {
    const view = splitMultipart(text, boundary[1] ?? boundary[2])
    if (view) return view
  }
  if (type.startsWith('application/x-www-form-urlencoded') && text && !/[\s]/.test(text.trim())) {
    return { kind: 'form', fields: splitPairs(text.trim()).map(({ name, value }) => ({ name, value })) }
  }
  return { kind: 'text', text }
}

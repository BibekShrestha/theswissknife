/**
 * A small non-validating XML reader for KML, copied from tools/kml (tools
 * never import each other). It never expands DTD entities: a DOCTYPE is skipped
 * whole, so an entity bomb costs nothing. Only the five predefined entities
 * and character references are decoded. One linear pass, no recursion.
 *
 * Element names keep their prefix ("gx:Track"); `local` drops it, which is
 * how KML is matched — files in the wild mix kml:, gx: and no prefix.
 */

export interface XmlElement {
  name: string
  local: string
  attrs: Record<string, string>
  children: XmlElement[]
  /** Concatenated character data directly inside this element. */
  text: string
}

export class XmlError extends Error {}

const ENTITY: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole
    }
    return ENTITY[body] ?? whole
  })
}

const MAX_DEPTH = 512

function makeElement(name: string): XmlElement {
  const colon = name.indexOf(':')
  return { name, local: colon < 0 ? name : name.slice(colon + 1), attrs: {}, children: [], text: '' }
}

/** Reads attributes from the inside of a start tag, after the name. */
function readAttrs(source: string, into: Record<string, string>) {
  const re = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source))) into[match[1]] = decodeEntities(match[2] ?? match[3] ?? '')
}

/** Index of the '>' that ends a tag starting at `from`, skipping quoted values. */
function tagEnd(text: string, from: number): number {
  let quote = ''
  for (let i = from; i < text.length; i++) {
    const c = text[i]
    if (quote) { if (c === quote) quote = ''; continue }
    if (c === '"' || c === "'") quote = c
    else if (c === '>') return i
  }
  return -1
}

export function parseXml(text: string): XmlElement {
  const root = makeElement('#document')
  const stack: XmlElement[] = [root]
  let pos = 0
  // Whitespace between tags is dropped, or a Document would collect a
  // newline per placemark; text that matters (names, coordinates) has some.
  const appendText = (raw: string) => {
    const top = stack[stack.length - 1]
    if (top !== root && /\S/.test(raw)) top.text += raw
  }

  while (pos < text.length) {
    const lt = text.indexOf('<', pos)
    if (lt < 0) { appendText(decodeEntities(text.slice(pos))); break }
    if (lt > pos) appendText(decodeEntities(text.slice(pos, lt)))

    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4)
      pos = end < 0 ? text.length : end + 3
    } else if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9)
      appendText(text.slice(lt + 9, end < 0 ? text.length : end))
      pos = end < 0 ? text.length : end + 3
    } else if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2)
      pos = end < 0 ? text.length : end + 2
    } else if (text.startsWith('<!', lt)) {
      // DOCTYPE, possibly with an internal subset in brackets: skipped, never expanded.
      const bracket = text.indexOf('[', lt)
      const close = text.indexOf('>', lt)
      if (bracket >= 0 && close >= 0 && bracket < close) {
        const subsetEnd = text.indexOf(']', bracket)
        const end = subsetEnd < 0 ? -1 : text.indexOf('>', subsetEnd)
        pos = end < 0 ? text.length : end + 1
      } else {
        pos = close < 0 ? text.length : close + 1
      }
    } else if (text[lt + 1] === '/') {
      const end = text.indexOf('>', lt)
      const name = text.slice(lt + 2, end < 0 ? text.length : end).trim()
      // Close the nearest open element of that name; a stray end tag is ignored.
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === name) { stack.length = i; break }
      }
      pos = end < 0 ? text.length : end + 1
    } else {
      const end = tagEnd(text, lt + 1)
      if (end < 0) throw new XmlError('A tag is never closed with ">" — the file looks cut off')
      let body = text.slice(lt + 1, end)
      const selfClosing = body.endsWith('/')
      if (selfClosing) body = body.slice(0, -1)
      const nameMatch = /^[^\s/>]+/.exec(body)
      if (!nameMatch) { appendText('<'); pos = lt + 1; continue }
      const element = makeElement(nameMatch[0])
      readAttrs(body.slice(nameMatch[0].length), element.attrs)
      stack[stack.length - 1].children.push(element)
      if (!selfClosing) {
        if (stack.length > MAX_DEPTH) throw new XmlError(`Elements are nested more than ${MAX_DEPTH} deep`)
        stack.push(element)
      }
      pos = end + 1
    }
  }
  return root
}

export function child(el: XmlElement, local: string): XmlElement | undefined {
  return el.children.find((c) => c.local === local)
}

export function childText(el: XmlElement, local: string): string | undefined {
  const c = child(el, local)
  return c ? c.text.trim() : undefined
}

/** The encoding named in the XML declaration, if any. */
export function declaredEncoding(head: string): string | undefined {
  return /^\s*<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/.exec(head)?.[1]
}

/**
 * Synthetic hostile PDFs for the work guard and the runner's deadline.
 * Built by hand so the bomb sits exactly where pdf-lib would inflate it.
 */
import { PDFDocument, PDFName } from 'pdf-lib'
import { ascii, concatBytes, deflate, latin1 } from './node'

/** A one-page document written without object streams, as bytes and the offset where its xref section starts. */
async function basePdf(): Promise<{ body: Uint8Array; size: number }> {
  const doc = await PDFDocument.create()
  doc.addPage([200, 200])
  const bytes = await doc.save({ useObjectStreams: false })
  const text = latin1(bytes)
  const at = text.lastIndexOf('\nxref')
  const size = Number(/\/Size (\d+)/.exec(text.slice(at))![1])
  return { body: bytes.subarray(0, at + 1), size }
}

/**
 * An object stream whose one object is followed by `decodedBytes` of spaces
 * (deflate shrinks them about a thousandfold). The file has no xref section,
 * so lib/parse.ts cannot tell live object streams from stale ones and
 * unpacks every one — the bomb is inflated during parsing.
 */
export async function objectStreamBomb(decodedBytes: number, filter = '/FlateDecode'): Promise<Uint8Array> {
  const { body, size } = await basePdf()
  const header = `${size + 1} 0 `
  const payload = new Uint8Array(header.length + 16 + decodedBytes).fill(0x20)
  payload.set(ascii(`${header}<< /Bomb true >>`))
  const packed = deflate(payload)
  return concatBytes(
    body,
    ascii(`${size} 0 obj\n<< /Type /ObjStm /N 1 /First ${header.length} /Filter ${filter} /Length ${packed.length} >>\nstream\n`),
    packed,
    ascii('\nendstream\nendobj\n%%EOF\n'),
  )
}

/** The trailer's startxref points at an xref stream that inflates to `decodedBytes` of zeros. */
export async function xrefStreamBomb(decodedBytes: number): Promise<Uint8Array> {
  const { body, size } = await basePdf()
  const packed = deflate(new Uint8Array(decodedBytes))
  const root = /\/Root (\d+ \d+ R)/.exec(latin1(body))?.[1] ?? '1 0 R'
  const at = body.length
  return concatBytes(
    body,
    ascii(`${size} 0 obj\n<< /Type /XRef /Size ${size + 1} /W [1 4 2] /Root ${root} /Filter /FlateDecode /Length ${packed.length} >>\nstream\n`),
    packed,
    ascii(`\nendstream\nendobj\nstartxref\n${at}\n%%EOF\n`),
  )
}

/** A page tree of `depth` levels where every node lists the same child twice: 2^depth paths to one page. */
export async function sharedPageTree(depth: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([200, 200])
  let child = page.ref
  for (let i = 0; i < depth; i++) {
    const node = doc.context.obj({ Type: 'Pages', Kids: [child, child], Count: 2 ** (i + 1) })
    child = doc.context.register(node)
  }
  doc.catalog.set(PDFName.of('Pages'), child)
  return doc.save({ useObjectStreams: false })
}

/**
 * What page-level edits do to everything that points at pages: links,
 * bookmarks, form fields, named destinations, page labels, the structure
 * tree — and that a page left out of the output never rides along inside it.
 */
import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString, StandardFonts } from 'pdf-lib'
import { makeRichPdf, nodePdfJs, pageObjectCount, rawObjects } from '../test/helpers'
import { inflate, latin1 } from '../test/node'
import { mergePdfs, removePages, reorderPages, splitPdf } from './organize'

const SECRET = 'TOPSECRETPAGE'

interface Spec {
  pages: number
  /** page index → the page indices it links to (explicit /Dest arrays) */
  links?: Record<number, number[]>
  /** page index → the page indices it links to through named destinations */
  namedLinks?: Record<number, number[]>
  /** page whose text is SECRET instead of "Page n" */
  secret?: number
  /** a text field with one widget on each of these pages */
  fieldOn?: number[]
  /** bookmarks: title → page index */
  outline?: Record<string, number>
  labels?: boolean
  attachment?: boolean
  xmp?: boolean
  tagged?: boolean
  fieldName?: string
}

/** A document built to exercise every kind of reference to a page. */
async function makeLinkedPdf(spec: Spec): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const { context } = doc
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pages = Array.from({ length: spec.pages }, (_, i) => {
    const page = doc.addPage([300, 400])
    page.drawText(i === spec.secret ? SECRET : `Page ${i + 1}`, { x: 20, y: 20, size: 12, font })
    return page
  })
  const names: (PDFString | PDFRef)[] = []
  const nameFor = (t: number) => `dest-${t}`
  const annotate = (from: number, targets: number[], named: boolean) => {
    const annots = pages[from].node.lookup(PDFName.of('Annots')) as PDFArray | undefined ?? context.obj([])
    targets.forEach((t, k) => {
      const dest = named ? PDFString.of(nameFor(t)) : context.obj([pages[t].ref, PDFName.of('Fit')])
      const link = context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10 + k * 12, named ? 300 : 350, 20 + k * 12, named ? 310 : 360], Border: [0, 0, 0], Dest: dest })
      annots.push(context.register(link))
    })
    pages[from].node.set(PDFName.of('Annots'), annots)
  }
  for (const [from, targets] of Object.entries(spec.links ?? {})) annotate(Number(from), targets, false)
  for (const [from, targets] of Object.entries(spec.namedLinks ?? {})) {
    annotate(Number(from), targets, true)
    for (const t of targets) {
      if (!names.some((n) => n instanceof PDFString && n.asString() === nameFor(t))) {
        names.push(PDFString.of(nameFor(t)), context.register(context.obj([pages[t].ref, PDFName.of('Fit')])))
      }
    }
  }
  if (names.length) {
    const sorted: (PDFString | PDFRef)[] = []
    const pairs = Array.from({ length: names.length / 2 }, (_, i) => [names[2 * i], names[2 * i + 1]] as const)
    pairs.sort((a, b) => (a[0] as PDFString).asString().localeCompare((b[0] as PDFString).asString())).forEach(([k, v]) => sorted.push(k, v))
    doc.catalog.set(PDFName.of('Names'), context.obj({ Dests: context.obj({ Names: sorted }) }))
  }
  if (spec.fieldOn) {
    const field = doc.getForm().createTextField(spec.fieldName ?? 'name')
    field.setText('Ada')
    for (const p of spec.fieldOn) field.addToPage(pages[p], { x: 20, y: 200, width: 150, height: 24 })
  }
  if (spec.outline) {
    const root = context.obj({ Type: 'Outlines' }) as PDFDict
    const rootRef = context.register(root)
    const items = Object.entries(spec.outline).map(([title, p]) => context.obj({ Title: PDFHexString.fromText(title), Parent: rootRef, Dest: [pages[p].ref, PDFName.of('Fit')] }) as PDFDict)
    const refs = items.map((item) => context.register(item))
    items.forEach((item, i) => {
      if (i > 0) item.set(PDFName.of('Prev'), refs[i - 1])
      if (i < refs.length - 1) item.set(PDFName.of('Next'), refs[i + 1])
    })
    root.set(PDFName.of('First'), refs[0])
    root.set(PDFName.of('Last'), refs[refs.length - 1])
    root.set(PDFName.of('Count'), context.obj(refs.length))
    doc.catalog.set(PDFName.of('Outlines'), rootRef)
  }
  if (spec.labels) {
    // i, ii, then A-1, A-2, …
    doc.catalog.set(PDFName.of('PageLabels'), context.obj({ Nums: [0, { S: 'r' }, 2, { S: 'D', P: PDFString.of('A-') }] }))
  }
  if (spec.attachment) await doc.attach(new TextEncoder().encode('hello'), 'notes.txt', { mimeType: 'text/plain' })
  if (spec.xmp) {
    const xmp = context.flateStream('<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">XMP title</rdf:li></rdf:Alt></dc:title></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>', { Type: 'Metadata', Subtype: 'XML' })
    doc.catalog.set(PDFName.of('Metadata'), context.register(xmp))
  }
  if (spec.tagged) {
    // one paragraph element per page, each with ActualText naming its page
    const root = context.obj({ Type: 'StructTreeRoot' }) as PDFDict
    const rootRef = context.register(root)
    const kids = pages.map((page, i) => {
      page.node.set(PDFName.of('StructParents'), context.obj(i))
      return context.register(context.obj({ Type: 'StructElem', S: 'P', P: rootRef, Pg: page.ref, K: 0, ActualText: PDFString.of(i === spec.secret ? SECRET : `Text ${i + 1}`) }))
    })
    root.set(PDFName.of('K'), context.obj(kids))
    root.set(PDFName.of('ParentTree'), context.obj({ Nums: kids.flatMap((k, i) => [i, context.obj([k])]) }))
    root.set(PDFName.of('ParentTreeNextKey'), context.obj(kids.length))
    doc.catalog.set(PDFName.of('StructTreeRoot'), rootRef)
    doc.catalog.set(PDFName.of('MarkInfo'), context.obj({ Marked: true }))
  }
  doc.setTitle('Linked fixture')
  doc.setAuthor('Fixture author')
  return doc.save()
}

/** Everything pdf.js sees: page texts, where each link lands, bookmarks, fields, labels, metadata. */
async function inspect(bytes: Uint8Array) {
  const pdfjs = await nodePdfJs()
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 })
  const doc = await task.promise
  try {
    const target = async (dest: unknown): Promise<number | null> => {
      const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest
      if (!Array.isArray(explicit) || !explicit[0] || typeof explicit[0] !== 'object') return null
      try {
        return await doc.getPageIndex(explicit[0])
      } catch {
        return null
      }
    }
    const texts: string[] = []
    const links: (number | null)[][] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      texts.push((await page.getTextContent()).items.map((it) => ('str' in it ? it.str : '')).join(''))
      const annots = (await page.getAnnotations()) as { subtype: string; dest?: unknown }[]
      links.push(await Promise.all(annots.filter((a) => a.subtype === 'Link').map((a) => target(a.dest))))
    }
    const outline = await Promise.all(((await doc.getOutline()) ?? []).map(async (o) => [o.title, await target(o.dest)] as const))
    const fields = await doc.getFieldObjects()
    const { info, metadata } = (await doc.getMetadata()) as unknown as { info: Record<string, unknown>; metadata: { get(k: string): unknown } | null }
    const attachments = await doc.getAttachments()
    return {
      texts,
      links,
      outline,
      fields: fields ? Object.keys(fields).sort() : [],
      fieldWidgetPages: fields ? Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, (v as { page?: number }[]).map((w) => w.page ?? -1).filter((p) => p >= 0)])) : {},
      labels: await doc.getPageLabels(),
      title: info.Title,
      author: info.Author,
      xmpTitle: metadata?.get('dc:title') ?? null,
      attachments: attachments ? (attachments instanceof Map ? [...attachments.keys()] : Object.keys(attachments)).sort() : [],
    }
  } finally {
    await task.destroy()
  }
}

/** Fails if anything of the left-out page survives: its content, its page object, its tagged text. */
/**
 * Every place the marker could hide in the file's bytes, found without any
 * PDF parser: the raw file, and every stream in it inflated (content streams
 * and object streams are Flate-compressed), each searched for the marker as
 * text and in the hex form pdf-lib writes strings in.
 */
function bytesMention(bytes: Uint8Array, marker: string): string[] {
  const hexMarker = [...marker].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  const has = (text: string) => text.includes(marker) || text.toLowerCase().replace(/[\s<>]/g, '').includes(hexMarker)
  const raw = latin1(bytes)
  const found: string[] = []
  if (has(raw)) found.push('raw file')
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const start = m.index! + m[0].length
    const end = raw.indexOf('endstream', start)
    if (end < 0) continue
    try {
      if (has(latin1(inflate(bytes.subarray(start, end))))) found.push(`stream at ${start}`)
    } catch {
      // not Flate: the raw-file search above covers uncompressed streams
    }
  }
  return found
}

async function expectNoLeftovers(bytes: Uint8Array, pageCount: number) {
  expect(bytesMention(bytes, SECRET), 'bytes of the output that still carry the left-out page').toEqual([])
  const objects = await rawObjects(bytes)
  expect(objects.filter((o) => o.text.includes(SECRET)).map((o) => o.ref.toString()), 'objects mentioning the secret page').toEqual([])
  expect(await pageObjectCount(bytes)).toBe(pageCount)
}

describe('pages left out are not copied into the output (PDF-1)', () => {
  const secretDoc = () => makeLinkedPdf({ pages: 3, secret: 2, links: { 0: [2, 1] }, namedLinks: { 0: [2] }, fieldOn: [0, 2], outline: { One: 0, Secret: 2 }, tagged: true })

  it('finds the secret in the input (the check below can see it)', async () => {
    const found = bytesMention(await secretDoc(), SECRET)
    expect(found.length).toBeGreaterThan(1) // the page's content stream and its tagged ActualText
  })

  it('Remove Pages', async () => {
    const out = await removePages(await secretDoc(), '3')
    await expectNoLeftovers(out, 2)
    expect((await inspect(out)).texts).toEqual(['Page 1', 'Page 2'])
  })

  it('Split PDF', async () => {
    const [first, rest] = await splitPdf(await secretDoc(), { kind: 'ranges', ranges: '1,2' })
    await expectNoLeftovers(first.bytes, 1)
    await expectNoLeftovers(rest.bytes, 1)
  })

  it('Reorder Pages keeps exactly one copy of every page', async () => {
    const out = await reorderPages(await makeLinkedPdf({ pages: 3, links: { 0: [2, 1] }, fieldOn: [0, 2] }), '3,1,2')
    expect(await pageObjectCount(out)).toBe(3)
  })

  it('Merge PDF: two 10-page files whose first page links to every page', async () => {
    const ten = await makeLinkedPdf({ pages: 10, links: { 0: [...Array(10).keys()] } })
    const { bytes } = await mergePdfs([{ name: 'a.pdf', bytes: ten }, { name: 'b.pdf', bytes: ten }])
    expect(await pageObjectCount(bytes)).toBe(20)
  })
})

describe('links land on the right page (PDF-2)', () => {
  it('Merge: each file’s links point into its own pages', async () => {
    const ten = await makeLinkedPdf({ pages: 10, links: { 0: [...Array(10).keys()] }, namedLinks: { 1: [9] } })
    const { bytes } = await mergePdfs([{ name: 'a.pdf', bytes: ten }, { name: 'b.pdf', bytes: ten }])
    const { links } = await inspect(bytes)
    expect(links[0]).toEqual([...Array(10).keys()])
    expect(links[10]).toEqual([...Array(10).keys()].map((i) => i + 10))
    expect(links[1]).toEqual([9])
    expect(links[11]).toEqual([19])
  })

  it('Reorder: links follow the pages they pointed at', async () => {
    const out = await reorderPages(await makeLinkedPdf({ pages: 3, links: { 0: [1, 2] }, namedLinks: { 2: [0] } }), '3,1,2')
    const { texts, links } = await inspect(out)
    expect(texts).toEqual(['Page 3', 'Page 1', 'Page 2'])
    expect(links).toEqual([[1], [2, 0], []])
  })

  it('Remove: links to removed pages are gone, the rest are re-pointed', async () => {
    const out = await removePages(await makeLinkedPdf({ pages: 4, links: { 0: [1, 2, 3] }, namedLinks: { 3: [1, 0] } }), '2')
    const { texts, links } = await inspect(out)
    expect(texts).toEqual(['Page 1', 'Page 3', 'Page 4'])
    expect(links).toEqual([[1, 2], [], [0]])
  })

  it('Split: links to pages in another part are gone', async () => {
    const parts = await splitPdf(await makeLinkedPdf({ pages: 4, links: { 0: [1, 2, 3], 3: [2, 0] } }), { kind: 'every', pages: 2 })
    const [a, b] = await Promise.all(parts.map((p) => inspect(p.bytes)))
    expect(a.links).toEqual([[1], []])
    expect(b.links).toEqual([[], [0]])
  })
})

describe('document structure survives page edits (PDF-3)', () => {
  const rich = (fieldName = 'name') =>
    makeLinkedPdf({ pages: 4, fieldOn: [0, 3], fieldName, outline: { Intro: 0, Middle: 1, End: 3 }, labels: true, attachment: true, xmp: true, tagged: true, namedLinks: { 0: [3] } })

  it('Remove keeps metadata, fields, bookmarks, labels and attachments, minus what pointed at removed pages', async () => {
    const out = await inspect(await removePages(await rich(), '2,4'))
    expect(out).toMatchObject({
      texts: ['Page 1', 'Page 3'],
      title: 'Linked fixture',
      author: 'Fixture author',
      xmpTitle: 'XMP title',
      fields: ['name'],
      fieldWidgetPages: { name: [0] },
      outline: [['Intro', 0]],
      labels: ['i', 'A-1'],
      attachments: ['notes.txt'],
      links: [[], []],
    })
  })

  it('Reorder renumbers page labels to the new order', async () => {
    const out = await inspect(await reorderPages(await rich(), '4,3,2,1'))
    expect(out.labels).toEqual(['A-2', 'A-1', 'ii', 'i'])
    expect(out.outline).toEqual([['Intro', 3], ['Middle', 2], ['End', 0]])
    expect(out.fieldWidgetPages).toEqual({ name: [3, 0] })
    expect(out.links[3]).toEqual([0])
  })

  it('Split carries everything that belongs to each part', async () => {
    const [a, b] = await Promise.all((await splitPdf(await rich(), { kind: 'first', pages: 2 })).map((p) => inspect(p.bytes)))
    expect(a).toMatchObject({ title: 'Linked fixture', xmpTitle: 'XMP title', fields: ['name'], fieldWidgetPages: { name: [0] }, outline: [['Intro', 0], ['Middle', 1]], labels: ['i', 'ii'], attachments: ['notes.txt'] })
    expect(b).toMatchObject({ title: 'Linked fixture', fields: ['name'], fieldWidgetPages: { name: [1] }, outline: [['End', 1]], labels: ['A-1', 'A-2'] })
  })

  it('Merge keeps both files’ fields (renaming clashes, and saying so), bookmarks, labels and attachments', async () => {
    const { bytes, notes } = await mergePdfs([{ name: 'a.pdf', bytes: await rich() }, { name: 'b.pdf', bytes: await rich() }])
    const out = await inspect(bytes)
    expect(out).toMatchObject({
      title: 'Linked fixture',
      xmpTitle: 'XMP title',
      fields: ['name', 'name_2'],
      fieldWidgetPages: { name: [0, 3], name_2: [4, 7] },
      outline: [['Intro', 0], ['Middle', 1], ['End', 3], ['Intro', 4], ['Middle', 5], ['End', 7]],
      labels: ['i', 'ii', 'A-1', 'A-2', 'i', 'ii', 'A-1', 'A-2'],
      attachments: ['notes (2).txt', 'notes.txt'],
    })
    expect(out.links[4]).toEqual([7])
    expect(notes.join(' ')).toMatch(/“name” from b\.pdf.*“name_2”/)
  })

  it('Merge of makeRichPdf files keeps the filled value and the bookmark', async () => {
    const { bytes } = await mergePdfs([{ name: 'a.pdf', bytes: await makeRichPdf() }, { name: 'b.pdf', bytes: await makeRichPdf() }])
    const doc = await PDFDocument.load(bytes)
    expect(doc.getTitle()).toBe('Rich fixture')
    expect(doc.getAuthor()).toBe('Fixture author')
    expect(doc.getForm().getTextField('name').getText()).toBe('Ada')
    expect(doc.getForm().getTextField('name_2').getText()).toBe('Ada')
    expect((await inspect(bytes)).outline).toEqual([['Chapter 1', 1], ['Chapter 1', 3]])
  })

  it('Merge keeps the structure tree of every file, each page pointing at its own elements', async () => {
    const tagged = await makeLinkedPdf({ pages: 2, tagged: true })
    const { bytes } = await mergePdfs([{ name: 'a.pdf', bytes: tagged }, { name: 'b.pdf', bytes: tagged }])
    const doc = await PDFDocument.load(bytes)
    const root = doc.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict)
    expect(root.lookup(PDFName.of('K'), PDFArray).size()).toBe(4)
    const parentTree = root.lookup(PDFName.of('ParentTree'), PDFDict).lookup(PDFName.of('Nums'), PDFArray)
    const keys = doc.getPages().map((p) => p.node.get(PDFName.of('StructParents'))!.toString())
    expect(keys).toEqual(['0', '1', '2', '3'])
    expect(parentTree.size()).toBe(8)
  })
})

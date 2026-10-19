import { describe, expect, it } from 'vitest'
import { PDFDict, PDFDocument, PDFName, PDFRef } from 'pdf-lib'
import { appendClassicUpdate, fixture, makePdf, pageTexts } from '../test/helpers'
import { latin1 } from '../test/node'
import { loadPdf } from './load'
import { liveObjectStreams } from './parse'
import { compressPdf } from '../ops/edit'
import { rotatePdf } from '../ops/organize'

/**
 * A base written with object streams and an xref stream (pdf-lib's default),
 * then saved incrementally with a classic xref table whose /Prev points back
 * at the xref stream — the objects in the base's object stream stay live.
 */
async function incrementalOnObjectStreams(rewriteTree: boolean) {
  const base = await makePdf(2)
  expect(latin1(base)).toContain('/ObjStm')
  const doc = await PDFDocument.load(base)
  const objects: Record<number, string> = {}
  const nextNumber = 50 // unused: the object and xref streams are numbered past largestObjectNumber
  objects[nextNumber] = '<< /Producer (incremental editor) >>'
  if (rewriteTree) {
    // catalog, page tree and pages move out of the object stream; the font dict stays in it
    const catalogRef = doc.context.trailerInfo.Root as PDFRef
    objects[catalogRef.objectNumber] = doc.catalog.toString()
    const pagesRef = doc.catalog.get(PDFName.of('Pages')) as PDFRef
    objects[pagesRef.objectNumber] = doc.context.lookup(pagesRef)!.toString()
    for (const page of doc.getPages()) {
      const dict = page.node.clone() as PDFDict
      dict.set(PDFName.of('Rotate'), doc.context.obj(90))
      objects[page.ref.objectNumber] = dict.toString()
    }
  }
  return appendClassicUpdate(base, objects)
}

describe('object streams below a classic-table incremental update (follows /Prev)', () => {
  it('Repro A: reads a file whose page tree lives in the base’s object stream', async () => {
    const input = await incrementalOnObjectStreams(false)
    expect(await pageTexts(input)).toEqual(['Page 1', 'Page 2']) // pdf.js reads it
    expect((await loadPdf(input)).getPageCount()).toBe(2)
  })

  it('Repro B: keeps objects the update did not rewrite (the font), so outputs are whole', async () => {
    const input = await incrementalOnObjectStreams(true)
    // the update wins over the base: its pages carry /Rotate 90
    expect((await loadPdf(input)).getPages().map((p) => p.getRotation().angle)).toEqual([90, 90])
    for (const [out, angle] of [[await compressPdf(input), 90], [await rotatePdf(input, 90), 180]] as const) {
      expect(await pageTexts(out)).toEqual(['Page 1', 'Page 2'])
      const doc = await PDFDocument.load(out)
      expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([angle, angle])
      const font = doc.getPage(0).node.Resources()!.lookup(PDFName.of('Font'), PDFDict)
      for (const [, ref] of font.entries()) expect(doc.context.lookup(ref as PDFRef), 'font object').toBeInstanceOf(PDFDict)
    }
  })

  it('still ignores the stale object stream PDFKit leaves behind', async () => {
    const input = fixture('pdfkit-resaved.pdf')
    expect((await liveObjectStreams(input))?.size).toBe(0)
    expect(await pageTexts(await compressPdf(input))).toEqual(['Hello page 1', 'Hello page 2', 'Hello page 3'])
  })

  it('names exactly the object streams an xref stream in the chain points into', async () => {
    const plain = await makePdf(2)
    const live = (await liveObjectStreams(plain))!
    expect(live.size).toBeGreaterThan(0)
    const streams = [...latin1(plain).matchAll(/(\d+) 0 obj\s*<<((?!>>)[\s\S])*?\/ObjStm/g)].map((m) => Number(m[1]))
    expect(streams.length).toBeGreaterThan(0)
    expect([...live].sort()).toEqual(streams.sort())
    expect(await liveObjectStreams(await incrementalOnObjectStreams(false))).toEqual(live)
  })
})

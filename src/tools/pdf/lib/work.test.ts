import { describe, expect, it } from 'vitest'
import { PDFContext, PDFName, PDFRawStream } from 'pdf-lib'
import { objectStreamBomb, sharedPageTree, xrefStreamBomb } from '../test/bomb'
import { pageTexts } from '../test/helpers'
import { ascii, concatBytes, deflate } from '../test/node'
import { runJob } from '../jobs'
import { loadPdf, PdfInputError } from './load'
import { inflateGuarded, PdfBombError, Work } from './work'

const MiB = 1024 * 1024

/** A Work with a small budget that records how much was inflated. */
function counted(maxInflatedBytes: number) {
  const seen = { total: 0 }
  const work = new Work({ maxInflatedBytes, onInflate: (_, total) => (seen.total = total) })
  return { work, seen }
}

describe('the inflate budget stops a decompression bomb by counting bytes', () => {
  it('in an object stream: refused once the budget is spent, long before the bomb is decoded', async () => {
    const bomb = await objectStreamBomb(64 * MiB)
    expect(bomb.length).toBeLessThan(MiB) // a few hundred KB that claims 64 MB
    const { work, seen } = counted(4 * MiB)
    await expect(loadPdf(bomb, 'bomb.pdf', { work })).rejects.toThrow(PdfBombError)
    await expect(loadPdf(bomb, 'bomb.pdf', { work: new Work({ maxInflatedBytes: 4 * MiB }) })).rejects.toThrow(/decompression bomb/)
    // stopped within one decoded chunk of the limit: the other 60 MB were never produced
    expect(seen.total).toBeGreaterThan(4 * MiB)
    expect(seen.total).toBeLessThan(5 * MiB)
  })

  it('in a cross-reference stream', async () => {
    const bomb = await xrefStreamBomb(64 * MiB)
    const { work, seen } = counted(2 * MiB)
    await expect(loadPdf(bomb, 'bomb.pdf', { work })).rejects.toThrow(PdfBombError)
    expect(seen.total).toBeLessThan(3 * MiB)
  })

  it('through pdf-lib’s own decoders too (filter arrays), a megabyte at a time', async () => {
    const bomb = await objectStreamBomb(64 * MiB, '[/FlateDecode]')
    const { work, seen } = counted(4 * MiB)
    await expect(loadPdf(bomb, 'bomb.pdf', { work })).rejects.toThrow(PdfBombError)
    expect(seen.total).toBeLessThan(6 * MiB)
  })

  it('reaches the person as a clear message from every job', async () => {
    const bomb = await objectStreamBomb(16 * MiB)
    await expect(runJob('compress', { bytes: bomb }, { work: { maxInflatedBytes: MiB } })).rejects.toThrow(/expands to more than 1 MB.*decompression bomb/)
    await expect(runJob('protect', { bytes: bomb, password: 'pw' }, { work: { maxInflatedBytes: MiB } })).rejects.toThrow(/decompression bomb/)
  })

  it('lets a real document through under the default budget', async () => {
    const small = await objectStreamBomb(1000)
    const doc = await loadPdf(small)
    expect(doc.getPageCount()).toBe(1)
    expect(await pageTexts(await runJob('compress', { bytes: small }))).toEqual([''])
  })
})

describe('inflateGuarded', () => {
  const stream = (contents: Uint8Array, filter = 'FlateDecode') => {
    const context = PDFContext.create()
    return PDFRawStream.of(context.obj({ Filter: filter, DecodeParms: { Predictor: 1 } }), contents)
  }

  it('decodes, and drops /Filter and /DecodeParms from the copy', async () => {
    const out = await inflateGuarded(stream(deflate(ascii('hello object stream'))), new Work())
    expect(new TextDecoder().decode(out.contents)).toBe('hello object stream')
    expect(out.dict.has(PDFName.of('Filter'))).toBe(false)
    expect(out.dict.has(PDFName.of('DecodeParms'))).toBe(false)
  })

  it('falls back to pdf-lib’s more forgiving decoder for data the browser’s rejects (trailing bytes)', async () => {
    const work = new Work()
    const out = await inflateGuarded(stream(concatBytes(deflate(ascii('with junk after')), ascii('\r\n  junk'))), work)
    expect(new TextDecoder().decode(out.contents)).toBe('with junk after')
    expect(work.inflated).toBe('with junk after'.length) // the failed attempt was refunded
  })

  it('keeps refusing once the budget is spent', async () => {
    const work = new Work({ maxInflatedBytes: 10 })
    await expect(inflateGuarded(stream(deflate(new Uint8Array(100))), work)).rejects.toThrow(PdfBombError)
    await expect(inflateGuarded(stream(deflate(new Uint8Array(1))), work)).rejects.toThrow(PdfBombError)
  })
})

describe('the page-tree walk', () => {
  it('refuses a tree that shares subtrees (2^40 paths) instead of walking every path', async () => {
    const bytes = await sharedPageTree(40)
    await expect(loadPdf(bytes)).rejects.toThrow(PdfInputError)
    await expect(loadPdf(bytes)).rejects.toThrow(/page tree is damaged/)
  })
})

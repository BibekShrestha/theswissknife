/**
 * Work accounting for one job, so a hostile file is stopped by counting
 * what it costs rather than by the clock alone.
 *
 * The one place pdf-lib inflates data while parsing is the object streams
 * and cross-reference streams lib/parse.ts unpacks — pdf-lib decodes those
 * whole, into one buffer, and a few kilobytes of deflate can claim gigabytes
 * (a decompression bomb). inflateGuarded decodes them here instead, chunk
 * by chunk, charging every byte to the job's Work and stopping at
 * maxInflatedBytes. Content streams and images are never decoded by these
 * tools, so they cost nothing.
 *
 * What slips past (a page tree built to loop, a file merely huge) is the
 * deadline's job: runner.ts terminates the worker when a job stops
 * reporting steps.
 */
import { PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import { PdfInputError } from './errors'

/** Real object and xref streams decode to kilobytes, at most a few megabytes; this is generous. */
export const MAX_INFLATED_BYTES = 256 * 1024 * 1024

/** Thrown when a file would inflate past the budget. Never swallowed by parse fallbacks. */
export class PdfBombError extends PdfInputError {}

const mib = (n: number) => `${Math.round(n / (1024 * 1024))} MB`

export interface WorkOptions {
  maxInflatedBytes?: number
  /** Called for every chunk inflated (tests drive a virtual clock with it). */
  onInflate?: (bytes: number, total: number) => void
  /** Called at each step of healthy, bounded work (the worker reports these as progress). */
  onStep?: () => void
}

export class Work {
  inflated = 0
  readonly maxInflatedBytes: number
  private exceeded: PdfBombError | null = null

  constructor(private readonly options: WorkOptions = {}) {
    this.maxInflatedBytes = options.maxInflatedBytes ?? MAX_INFLATED_BYTES
  }

  /** Charges `bytes` of decoded output; throws once the budget is spent (and on every call after). */
  inflate(bytes: number): void {
    if (this.exceeded) throw this.exceeded
    this.inflated += bytes
    this.options.onInflate?.(bytes, this.inflated)
    if (this.inflated > this.maxInflatedBytes) {
      this.exceeded = new PdfBombError(
        `This PDF expands to more than ${mib(this.maxInflatedBytes)} of internal data when decompressed — far more than any real document needs. ` +
          'It looks built to exhaust memory (a decompression bomb), so it was not processed.',
      )
      throw this.exceeded
    }
  }

  refund(bytes: number): void {
    this.inflated -= bytes
  }

  /** The budget error, if the budget was ever exceeded — parsers that swallow errors are checked with this. */
  get error(): PdfBombError | null {
    return this.exceeded
  }

  step(): void {
    this.options.onStep?.()
  }
}

let ambient: Work | null = null

/** The running job's Work, or a fresh default budget outside a job. */
export function currentWork(): Work {
  return ambient ?? new Work()
}

/** Reports a step of the running job, if there is one. */
export function step(): void {
  ambient?.step()
}

/** Runs one job with `work` as the ambient budget. Jobs in the worker run one at a time. */
export async function withWork<T>(work: Work, run: () => Promise<T>): Promise<T> {
  const previous = ambient
  ambient = work
  try {
    return await run()
  } finally {
    ambient = previous
  }
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1) return chunks[0]
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

class DecodeFailed extends Error {}

/**
 * The browser's streaming inflater: its output arrives in small chunks
 * however the deflate blocks are laid out, so the budget stops a bomb within
 * one chunk of the limit. Rejects with DecodeFailed for data it will not
 * decode (a bad checksum, trailing bytes) — pdf-lib's own decoder is more
 * forgiving and gets those.
 */
async function nativeInflate(data: Uint8Array, work: Work): Promise<{ bytes: Uint8Array; charged: number }> {
  const ds = new DecompressionStream('deflate')
  const writer = ds.writable.getWriter()
  writer.write(data as Uint8Array<ArrayBuffer>).catch(() => undefined)
  writer.close().catch(() => undefined)
  const reader = ds.readable.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      let next: ReadableStreamReadResult<Uint8Array>
      try {
        next = await reader.read()
      } catch {
        throw new DecodeFailed()
      }
      if (next.done) break
      total += next.value.length
      chunks.push(next.value)
      work.inflate(next.value.length)
    }
  } catch (e) {
    reader.cancel().catch(() => undefined)
    if (e instanceof DecodeFailed) work.refund(total)
    throw e
  }
  return { bytes: concat(chunks, total), charged: total }
}

const CHUNK = 1 << 20

/** pdf-lib's decoders, read a megabyte at a time so the budget is checked between blocks. */
function libraryInflate(stream: PDFRawStream, work: Work): Uint8Array {
  const decoder = decodePDFRawStream(stream)
  for (;;) {
    const got = decoder.getBytes(CHUNK).length
    work.inflate(got)
    if (got < CHUNK) break
  }
  // the input is exhausted: decode() hands back the whole buffer without decoding again
  return decoder.decode()
}

/**
 * `stream` decoded, as a filter-less copy that pdf-lib's object-stream and
 * xref-stream parsers read as it is. pdf-lib applies no predictors, so
 * dropping /DecodeParms with /Filter changes nothing it would have read.
 */
export async function inflateGuarded(stream: PDFRawStream, work: Work): Promise<PDFRawStream> {
  const filter = stream.dict.lookup(PDFName.of('Filter'))
  if (filter === undefined) return stream
  let bytes: Uint8Array | undefined
  if (filter === PDFName.of('FlateDecode') && typeof DecompressionStream === 'function') {
    try {
      bytes = (await nativeInflate(stream.contents, work)).bytes
    } catch (e) {
      if (!(e instanceof DecodeFailed)) throw e
    }
  }
  bytes ??= libraryInflate(stream, work)
  const dict = stream.dict.clone()
  dict.delete(PDFName.of('Filter'))
  dict.delete(PDFName.of('DecodeParms'))
  return PDFRawStream.of(dict, bytes)
}

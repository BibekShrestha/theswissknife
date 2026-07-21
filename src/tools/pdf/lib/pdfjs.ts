type PdfJsModule = typeof import('pdfjs-dist')
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

let pdfJsPromise: Promise<PdfJsModule> | null = null

export async function getPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsPromise) {
    pdfJsPromise = import('pdfjs-dist').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl
      return pdfjs
    })
  }
  return pdfJsPromise
}

export function getTextItemString(item: unknown): string {
  if (item && typeof item === 'object' && 'str' in item && typeof (item as { str: unknown }).str === 'string') {
    return (item as { str: string }).str
  }
  return ''
}

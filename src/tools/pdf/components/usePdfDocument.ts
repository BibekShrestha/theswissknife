import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { describeError } from '../lib/errors'
import { getPdfJs } from '../lib/pdfjs'
import { openPdf } from '../ops/read'

interface Opened {
  file: File | undefined
  doc: PDFDocumentProxy | null
  error: string
}

/**
 * The chosen file opened with pdf.js, for page thumbnails (and PDF to
 * Image's renders). Closed when the file changes or the screen goes.
 */
export function usePdfDocument(file: File | undefined): { doc: PDFDocumentProxy | null; error: string; loading: boolean } {
  const [opened, setOpened] = useState<Opened>({ file: undefined, doc: null, error: '' })

  useEffect(() => {
    if (!file) return
    let cancelled = false
    let close: (() => Promise<void>) | null = null
    ;(async () => {
      try {
        const pdf = await openPdf(await getPdfJs(), new Uint8Array(await file.arrayBuffer()))
        if (cancelled) return void pdf.close()
        close = pdf.close
        setOpened({ file, doc: pdf.doc, error: '' })
      } catch (e) {
        if (!cancelled) setOpened({ file, doc: null, error: describeError(e) })
      }
    })()
    return () => {
      cancelled = true
      void close?.()
    }
  }, [file])

  // a result for an earlier file is never shown against this one
  const current = opened.file === file && file !== undefined
  return {
    doc: current ? opened.doc : null,
    error: current ? opened.error : '',
    loading: file !== undefined && !current,
  }
}

/**
 * State that belongs to one document — a page order, a selection — and
 * starts over from `init` when the document changes.
 */
export function useDocState<T>(doc: PDFDocumentProxy | null, init: (pages: number) => T): [T, (next: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState(() => ({ doc, value: init(doc?.numPages ?? 0) }))
  let current = state
  if (state.doc !== doc) {
    current = { doc, value: init(doc?.numPages ?? 0) }
    setState(current)
  }
  const set = (next: T | ((prev: T) => T)) =>
    setState((s) => ({ doc: s.doc, value: typeof next === 'function' ? (next as (prev: T) => T)(s.value) : next }))
  return [current.value, set]
}

export const pageRange = (n: number) => Array.from({ length: n }, (_, i) => i)

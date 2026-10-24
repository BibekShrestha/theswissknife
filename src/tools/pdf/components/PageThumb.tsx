import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'

/** The longest side of a thumbnail, in CSS pixels; the frame around it is square so a turned page still fits. */
export const THUMB_SIZE = 112

/**
 * One render at a time per document, in the order pages scroll into view:
 * pdf.js renders in its own worker anyway, and a queue lets a page that has
 * left the screen drop out before it is drawn.
 */
const queues = new WeakMap<PDFDocumentProxy, Promise<void>>()

function enqueue(doc: PDFDocumentProxy, job: () => Promise<void>): Promise<void> {
  const next = (queues.get(doc) ?? Promise.resolve()).then(job)
  const settled = next.catch(() => undefined)
  queues.set(doc, settled)
  return next
}

interface PageThumbProps {
  doc: PDFDocumentProxy
  /** 0-based page index. */
  page: number
  /** Extra clockwise turn shown on top of the page's own, in degrees. */
  rotation?: number
}

/** A page drawn small, once it comes near the screen. Decorative: the control around it carries the name. */
export function PageThumb({ doc, page, rotation = 0 }: PageThumbProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<'waiting' | 'done' | 'failed'>('waiting')

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    let cancelled = false
    let visible = false
    let queued = false
    let drawn = false
    let task: RenderTask | null = null

    const draw = async () => {
      queued = false
      if (cancelled || !visible || drawn) return
      const p = await doc.getPage(page + 1)
      try {
        const base = p.getViewport({ scale: 1 })
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        const viewport = p.getViewport({ scale: (THUMB_SIZE / Math.max(base.width, base.height)) * dpr })
        el.width = Math.max(1, Math.floor(viewport.width))
        el.height = Math.max(1, Math.floor(viewport.height))
        el.style.width = `${el.width / dpr}px`
        el.style.height = `${el.height / dpr}px`
        task = p.render({ canvas: el, canvasContext: el.getContext('2d')!, viewport })
        await task.promise
        drawn = true
        if (!cancelled) setState('done')
      } finally {
        p.cleanup()
      }
    }
    const request = () => {
      if (queued || cancelled) return
      queued = true
      enqueue(doc, draw).catch((e: { name?: string }) => {
        if (!cancelled && e?.name !== 'RenderingCancelledException') setState('failed')
      })
    }

    // jsdom and very old engines have no IntersectionObserver: draw straight away
    if (typeof IntersectionObserver === 'undefined') {
      visible = true
      request()
      return () => {
        cancelled = true
        task?.cancel()
      }
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting
        if (visible && !drawn) request()
      },
      { rootMargin: '400px 0px' },
    )
    // the canvas is hidden until drawn, so watch its frame
    io.observe(el.parentElement ?? el)
    return () => {
      cancelled = true
      io.disconnect()
      task?.cancel()
    }
  }, [doc, page])

  return (
    <span className={`pdf-thumb${state === 'done' ? ' is-done' : ''}`} aria-hidden="true">
      <canvas ref={canvas} style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined} />
      {state === 'failed' && <span className="pdf-thumb-failed material-symbols-outlined" aria-hidden="true">broken_image</span>}
    </span>
  )
}

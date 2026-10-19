import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { PageViewport, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { getPdfJs } from '../lib/pdfjs'
import { CHECK_BOX, CHECK_PATH, TEXT_FONT_STACK, TEXT_LINE_HEIGHT } from '../lib/stamp'
import { renderScale } from '../ops/read'
import type { FieldInfo, FieldValue, WidgetInfo } from '../ops/form'
import { itemName, type Placed } from './model'
import { centreOn, clampBox, nudge, resizeBox, type Box, type Pt, type Size } from './pad'
import type { SignatureImage } from './raster'

interface Props {
  doc: PDFDocumentProxy
  page: number
  pageCount: number
  onPage: (page: number) => void
  fields: FieldInfo[]
  values: Record<string, FieldValue>
  activeField: number | null
  items: Placed[]
  signatures: SignatureImage[]
  selected: number | null
  /** An item waiting for a click on the page that says where it goes. */
  placing: number | null
  /** The displayed size of a page (points, rotation applied), once it is known. */
  onView: (page: number, size: Size) => void
  onFieldPointer: (field: number, widget: WidgetInfo) => void
  onSelect: (id: number | null) => void
  onChange: (id: number, box: Box) => void
  onPlaced: (id: number, box: Box) => void
  onRemove: (id: number) => void
}

const MAX_CSS_SCALE = 2

type Gesture = 'move' | 'resize'
type Drag = { id: number; mode: Gesture; x0: number; y0: number; box: Box; moved: boolean }

/** The widget's rectangle on the displayed page, in points from the top-left. */
function widgetBox(viewport: PageViewport, rect: WidgetInfo['rect']): Box {
  const [x1, y1] = viewport.convertToViewportPoint(rect[0], rect[1]) as [number, number]
  const [x2, y2] = viewport.convertToViewportPoint(rect[2], rect[3]) as [number, number]
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }
}

function markerText(field: FieldInfo, widget: WidgetInfo, value: FieldValue | undefined): string {
  if (field.kind === 'checkbox') return value === true ? '✓' : ''
  if (field.kind === 'radio') return value !== '' && value === widget.option ? '●' : ''
  if (Array.isArray(value)) return value.join(', ')
  return typeof value === 'string' ? value : ''
}

/**
 * One page drawn by pdf.js with the form's fields and the placed items over
 * it. Fields here are a pointer shortcut to the list's controls (hidden from
 * screen readers, which use the list); placed items are focusable and move
 * with the arrow keys.
 */
export function PageView(props: Props) {
  const { doc, page, pageCount, onPage, fields, values, activeField, items, signatures, selected, placing } = props
  const hint = useId()
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const [avail, setAvail] = useState(0)
  const [viewport, setViewport] = useState<PageViewport | null>(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const drag = useRef<Drag | null>(null)
  const onView = useRef(props.onView)
  onView.current = props.onView

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const measure = () => {
      const w = Math.floor(el.getBoundingClientRect().width)
      setAvail((old) => (Math.abs(old - w) > 2 ? w : old))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // the page at scale 1 gives its displayed size in points; the canvas is drawn at the size it is shown
  useEffect(() => {
    if (!avail) return
    let cancelled = false
    let task: RenderTask | null = null
    ;(async () => {
      try {
        const [pdfjs, p] = await Promise.all([getPdfJs(), doc.getPage(page + 1)])
        if (cancelled) return
        const base = p.getViewport({ scale: 1 })
        setViewport(base)
        onView.current(page, { width: base.width, height: base.height })
        const cssScale = Math.min(MAX_CSS_SCALE, avail / base.width)
        const pixel = renderScale(base.width, base.height, cssScale * (window.devicePixelRatio || 1))
        const vp = p.getViewport({ scale: pixel })
        const el = canvas.current
        if (!el) return
        el.width = Math.floor(vp.width)
        el.height = Math.floor(vp.height)
        // form widgets are left off the canvas, since the overlay shows them with the values being typed:
        // in forms mode pdf.js skips editable ones, and the ones it gives their own canvas (checkboxes,
        // radios, read-only fields) go into a map that is never shown
        task = p.render({
          canvas: el,
          canvasContext: el.getContext('2d')!,
          viewport: vp,
          annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS,
          annotationCanvasMap: new Map(),
        })
        await task.promise
        setError('')
      } catch (e) {
        if (!cancelled && (e as { name?: string }).name !== 'RenderingCancelledException') setError('This page could not be drawn.')
      }
    })()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, page, avail])

  const view: Size | null = viewport ? { width: viewport.width, height: viewport.height } : null
  const scale = view ? Math.min(MAX_CSS_SCALE, avail / view.width) : 1

  const toPage = (e: { clientX: number; clientY: number }): Pt => {
    const r = layer.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }
  }

  function layerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget || !view) return
    if (placing !== null) {
      const item = items.find((i) => i.id === placing)
      if (item && item.page === page) {
        props.onPlaced(item.id, centreOn(item, toPage(e), view))
        document.getElementById(`pdf-fs-item-${item.id}`)?.focus()
        return
      }
    }
    props.onSelect(null)
  }

  function itemDown(e: PointerEvent<HTMLElement>, item: Placed, mode: Gesture) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const target = document.getElementById(`pdf-fs-item-${item.id}`)!
    target.focus()
    target.setPointerCapture(e.pointerId)
    props.onSelect(item.id)
    drag.current = { id: item.id, mode, x0: e.clientX, y0: e.clientY, box: { x: item.x, y: item.y, width: item.width, height: item.height }, moved: false }
  }

  function itemMove(e: PointerEvent<HTMLElement>) {
    const d = drag.current
    if (!d || !view) return
    const dx = (e.clientX - d.x0) / scale
    const dy = (e.clientY - d.y0) / scale
    if (!d.moved && Math.hypot(dx, dy) * scale < 2) return
    d.moved = true
    if (d.mode === 'move') props.onChange(d.id, clampBox({ ...d.box, x: d.box.x + dx, y: d.box.y + dy }, view))
    else props.onChange(d.id, resizeBox(d.box, Math.max((d.box.width + dx) / d.box.width, (d.box.height + dy) / d.box.height), view))
  }

  function itemUp() {
    const d = drag.current
    drag.current = null
    if (d?.moved && placing === d.id) props.onPlaced(d.id, items.find((i) => i.id === d.id)!)
  }

  const describe = (b: Box) => `at ${Math.round(b.x)}, ${Math.round(b.y)} points, ${Math.round(b.width)} by ${Math.round(b.height)}`

  function itemKey(e: KeyboardEvent<HTMLElement>, item: Placed) {
    if (!view) return
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      props.onRemove(item.id)
      setStatus(`${itemName(item)} removed`)
      return
    }
    if (e.key === 'Escape') {
      props.onSelect(null)
      return
    }
    let next = nudge(item, e.key, e.shiftKey, view)
    if (!next && (e.key === '+' || e.key === '=')) next = resizeBox(item, 1.1, view)
    if (!next && (e.key === '-' || e.key === '_')) next = resizeBox(item, 1 / 1.1, view)
    if (!next && e.key === 'Enter' && placing === item.id) {
      props.onPlaced(item.id, item)
      setStatus(`${itemName(item)} placed ${describe(item)}`)
      return
    }
    if (!next) return
    e.preventDefault()
    if (placing === item.id) props.onPlaced(item.id, next)
    else props.onChange(item.id, next)
    setStatus(`${itemName(item)} ${describe(next)}`)
  }

  const here = items.filter((i) => i.page === page)

  return (
    <div className="pdf-fs-viewer">
      <div className="pdf-fs-pagebar">
        <button type="button" className="pdf-fs-btn icon" onClick={() => onPage(page - 1)} disabled={page <= 0} aria-label="Previous page">
          <span className="material-symbols-outlined" aria-hidden="true">chevron_left</span>
        </button>
        <span className="pdf-fs-pageno" aria-live="polite">
          Page {page + 1} of {pageCount}
        </span>
        <button type="button" className="pdf-fs-btn icon" onClick={() => onPage(page + 1)} disabled={page >= pageCount - 1} aria-label="Next page">
          <span className="material-symbols-outlined" aria-hidden="true">chevron_right</span>
        </button>
      </div>
      {placing !== null && here.some((i) => i.id === placing) && (
        <p className="pdf-fs-placing" role="status">
          Click the page where it should go, or drag it — arrow keys move it, Enter keeps it where it is.
        </p>
      )}
      <div className="pdf-fs-stage-wrap" ref={wrap}>
        {error ? (
          <p className="pdf-error">{error}</p>
        ) : (
          <div className="pdf-fs-stage" style={view ? { width: view.width * scale, height: view.height * scale } : undefined}>
            <canvas ref={canvas} className="pdf-fs-canvas" role="img" aria-label={`Page ${page + 1}`} />
            {view && viewport && (
              <div ref={layer} className={`pdf-fs-layer${placing !== null ? ' placing' : ''}`} onPointerDown={layerDown}>
                {fields.map((f, fi) =>
                  f.widgets.map((w, wi) => {
                    if (w.page !== page || w.hidden) return null
                    const b = widgetBox(viewport, w.rect)
                    const text = markerText(f, w, values[f.name])
                    const round = f.kind === 'radio'
                    return (
                      <div
                        key={`${fi}-${wi}`}
                        className={`pdf-fs-marker${activeField === fi ? ' on' : ''}${f.unsupported || f.readOnly ? ' off' : ''}${round ? ' round' : ''}${f.multiline ? ' multi' : ''}`}
                        style={{
                          left: b.x * scale,
                          top: b.y * scale,
                          width: b.width * scale,
                          height: b.height * scale,
                          fontSize: Math.max(7, Math.min(b.height * 0.68, 12) * scale),
                          letterSpacing: f.comb && f.maxLength ? `${Math.max(0, (b.width / f.maxLength) * scale - 7)}px` : undefined,
                        }}
                        aria-hidden="true"
                        title={f.label ?? f.name}
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          props.onFieldPointer(fi, w)
                        }}
                      >
                        {text}
                      </div>
                    )
                  }),
                )}
                {here.map((item) => {
                  const sig = item.sig !== undefined ? signatures[item.sig] : undefined
                  const name = itemName(item, sig?.label)
                  return (
                    <div
                      key={item.id}
                      id={`pdf-fs-item-${item.id}`}
                      className={`pdf-fs-item ${item.kind}${selected === item.id ? ' on' : ''}`}
                      style={{ left: item.x * scale, top: item.y * scale, width: item.width * scale, height: item.height * scale }}
                      role="button"
                      tabIndex={0}
                      aria-label={`${name}, page ${page + 1}`}
                      aria-describedby={hint}
                      aria-pressed={selected === item.id}
                      onFocus={() => props.onSelect(item.id)}
                      onKeyDown={(e) => itemKey(e, item)}
                      onPointerDown={(e) => itemDown(e, item, 'move')}
                      onPointerMove={itemMove}
                      onPointerUp={itemUp}
                      onPointerCancel={itemUp}
                    >
                      {item.kind === 'signature' && sig && <img src={sig.url} alt="" draggable={false} />}
                      {(item.kind === 'text' || item.kind === 'date') && (
                        <span className="pdf-fs-item-text" style={{ fontSize: (item.fontSize ?? 12) * scale, lineHeight: TEXT_LINE_HEIGHT, fontFamily: TEXT_FONT_STACK }}>
                          {item.text}
                        </span>
                      )}
                      {item.kind === 'check' && (
                        <svg viewBox={`0 0 ${CHECK_BOX} ${CHECK_BOX}`} aria-hidden="true" preserveAspectRatio="xMinYMin meet">
                          <path d={CHECK_PATH} />
                        </svg>
                      )}
                      {selected === item.id && <span className="pdf-fs-handle" aria-hidden="true" onPointerDown={(e) => itemDown(e, item, 'resize')} />}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
      <p id={hint} className="pdf-fs-sr">Arrow keys move it, Shift with an arrow by 10 points; plus and minus resize; Delete removes it.</p>
      <p className="pdf-fs-sr" role="status" aria-live="polite">{status}</p>
    </div>
  )
}

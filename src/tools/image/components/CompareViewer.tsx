import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clampOffset,
  dividerPercent,
  fitScale,
  sizeDelta,
  zoomLabel,
  zoomToward,
  type Point,
} from '../lib/compare'
import { formatBytes } from '../lib/naming'
import type { ItemResult, QueueItem } from '../useImagePipeline'

export type CompareItem = QueueItem & { result: ItemResult }

type Mode = 'split' | 'side' | 'flip'

const MODES: { id: Mode; label: string; icon: string; hint: string }[] = [
  { id: 'split', label: 'Split', icon: 'compare', hint: 'Drag the handle across the image' },
  { id: 'side', label: 'Side by side', icon: 'view_column', hint: 'Both at once, zooming together' },
  { id: 'flip', label: 'Flip', icon: 'sync_alt', hint: 'Hold F, or the button, to see the original' },
]

/**
 * Before/after viewer in the spirit of squoosh.app: one frame, both images
 * stacked on it, a divider that wipes between them, and zoom/pan shared by both
 * sides so you are always comparing the same pixels at the same magnification.
 *
 * The converted image is drawn into the original's frame, so a resize shows as
 * letterboxing rather than a silent rescale — what you see is the shape you
 * actually produced.
 */
export function CompareViewer({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: CompareItem[]
  index: number
  onIndex: (next: number) => void
  onClose: () => void
}) {
  const item = items[index]
  const stageRef = useRef<HTMLDivElement>(null)

  const [mode, setMode] = useState<Mode>('split')
  const [divider, setDivider] = useState(50)
  const [stage, setStage] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState<number | null>(null) // null = fit to the stage
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })
  const [showOriginal, setShowOriginal] = useState(false)
  const drag = useRef<{ kind: 'pan' | 'divider'; x: number; y: number; from: Point } | null>(null)

  // The source file needs a URL of its own, made here and released on the way
  // out, so a 30-file queue is not holding 30 decoded originals. Created inside
  // the effect that revokes it: a useMemo would hand StrictMode's double-run a
  // URL that its first cleanup had already revoked.
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  useEffect(() => {
    const url = URL.createObjectURL(item.file)
    setSourceUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [item.file])

  // The frame is the input's decoded size, which the worker already reported —
  // no waiting on an img load event that can fire before React is listening.
  const natural = { width: item.result.sourceWidth, height: item.result.sourceHeight }
  const fit = fitScale(natural, stage)
  const scale = zoom ?? fit
  const atFit = zoom === null

  const reset = useCallback(() => {
    setZoom(null)
    setOffset({ x: 0, y: 0 })
  }, [])

  // a different file means a different frame: back to fit
  useEffect(() => {
    reset()
  }, [item.id, reset])

  useEffect(() => {
    const node = stageRef.current
    if (!node) return
    const measure = () => setStage({ width: node.clientWidth, height: node.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const applyZoom = useCallback(
    (factor: number, pointer: Point = { x: 0, y: 0 }) => {
      const next = zoomToward({ scale, offset }, factor, pointer, natural, stage)
      setZoom(next.scale)
      setOffset(next.offset)
    },
    [natural, offset, scale, stage],
  )

  // Wheel zoom needs a non-passive listener, or the page scrolls instead.
  useEffect(() => {
    const node = stageRef.current
    if (!node) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = node.getBoundingClientRect()
      applyZoom(event.deltaY < 0 ? 1.15 : 1 / 1.15, {
        x: event.clientX - rect.left - rect.width / 2,
        y: event.clientY - rect.top - rect.height / 2,
      })
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [applyZoom])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') return onClose()
      if (event.key === 'f' || event.key === 'F') return setShowOriginal(true)
      if (event.key === '0') return reset()
      if (event.key === '1') return setZoom(1)
      if (event.key === '+' || event.key === '=') return applyZoom(1.25)
      if (event.key === '-') return applyZoom(1 / 1.25)
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const way = event.key === 'ArrowLeft' ? -1 : 1
        if (mode === 'split') {
          event.preventDefault()
          setDivider((d) => Math.min(100, Math.max(0, d + way * (event.shiftKey ? 1 : 5))))
        } else if (items.length > 1) {
          onIndex((index + way + items.length) % items.length)
        }
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'f' || event.key === 'F') setShowOriginal(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [applyZoom, index, items.length, mode, onClose, onIndex, reset])

  const startDrag = (event: React.PointerEvent, kind: 'pan' | 'divider') => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { kind, x: event.clientX, y: event.clientY, from: offset }
    if (kind === 'divider') moveDivider(event.clientX)
  }

  const continueDrag = (event: React.PointerEvent) => {
    const state = drag.current
    if (!state) return
    if (state.kind === 'divider') return moveDivider(event.clientX)
    setOffset(
      clampOffset(
        {
          x: state.from.x + (event.clientX - state.x),
          y: state.from.y + (event.clientY - state.y),
        },
        natural,
        stage,
        scale,
      ),
    )
  }

  const endDrag = (event: React.PointerEvent) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    drag.current = null
  }

  function moveDivider(clientX: number): void {
    const rect = stageRef.current?.getBoundingClientRect()
    if (rect) setDivider(dividerPercent(clientX, rect))
  }

  const result = item.result
  const delta = sizeDelta(item.file.size, result.bytes)
  const pannable = natural.width * scale > stage.width || natural.height * scale > stage.height
  const frame = {
    width: `${Math.max(1, natural.width * scale)}px`,
    height: `${Math.max(1, natural.height * scale)}px`,
    transform: `translate(${offset.x}px, ${offset.y}px)`,
  }
  const resized = result.sourceWidth !== result.width || result.sourceHeight !== result.height

  // In side-by-side the converted image lives in its own pane, so it is clipped
  // away entirely here; flip mode clips it while the original is held down.
  const convertedClip =
    mode === 'split'
      ? `inset(0 0 0 ${divider}%)`
      : mode === 'side' || (mode === 'flip' && showOriginal)
        ? 'inset(0 0 0 100%)'
        : undefined

  const dragProps = {
    onPointerDown: (event: React.PointerEvent) => startDrag(event, 'pan'),
    onPointerMove: continueDrag,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onDoubleClick: () => (atFit ? setZoom(1) : reset()),
  }

  const beforeTag = (
    <span className="image-compare-tag left">
      <b>Before</b> {item.source.toUpperCase()} · {result.sourceWidth} × {result.sourceHeight} ·{' '}
      {formatBytes(item.file.size)}
    </span>
  )
  const afterTag = (
    <span className="image-compare-tag right">
      <b>After</b> {result.format.toUpperCase()} · {result.width} × {result.height} ·{' '}
      {formatBytes(result.bytes)}{' '}
      <em className={delta.tone === 'flat' ? 'image-muted' : `image-${delta.tone}`}>{delta.text}</em>
    </span>
  )

  return (
    <div
      className="image-compare-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Compare ${result.name}`}
    >
      <div className="image-compare">
        <header className="image-compare-head">
          <div className="image-compare-title">
            <strong>{result.name}</strong>
            {items.length > 1 && (
              <span className="image-muted">
                {index + 1} of {items.length}
              </span>
            )}
          </div>

          <div className="spacer" />

          <div className="image-compare-modes" role="group" aria-label="Comparison mode">
            {MODES.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`image-chip${mode === option.id ? ' on' : ''}`}
                aria-pressed={mode === option.id}
                title={option.hint}
                onClick={() => setMode(option.id)}
              >
                <span className="material-symbols-outlined" aria-hidden>
                  {option.icon}
                </span>
                {option.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="image-icon-btn"
            onClick={onClose}
            aria-label="Close comparison"
          >
            <span className="material-symbols-outlined" aria-hidden>
              close
            </span>
          </button>
        </header>

        <div className={`image-compare-body${mode === 'side' ? ' side' : ''}`}>
          {items.length > 1 && (
            <button
              type="button"
              className="image-compare-step"
              onClick={() => onIndex((index - 1 + items.length) % items.length)}
              aria-label="Previous image"
            >
              <span className="material-symbols-outlined" aria-hidden>
                chevron_left
              </span>
            </button>
          )}

          <div
            className="image-compare-stage"
            ref={stageRef}
            data-pannable={pannable ? '' : undefined}
            {...dragProps}
          >
            {/* the original sits underneath; the converted one is wiped over it */}
            <div className="image-compare-layer">
              <div className="image-compare-frame" style={frame}>
                {sourceUrl && <img src={sourceUrl} alt="" draggable={false} />}
              </div>
            </div>

            <div className="image-compare-layer" style={{ clipPath: convertedClip }}>
              <div className="image-compare-frame" style={frame}>
                <img src={result.url} alt={result.name} draggable={false} />
              </div>
            </div>

            {mode === 'split' && (
              <div
                className="image-compare-divider"
                style={{ left: `${divider}%` }}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  startDrag(event, 'divider')
                }}
                onPointerMove={continueDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onDoubleClick={(event) => event.stopPropagation()}
                role="slider"
                tabIndex={0}
                aria-label="Comparison divider"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(divider)}
              >
                <span className="material-symbols-outlined" aria-hidden>
                  unfold_more
                </span>
              </div>
            )}

            {beforeTag}
            {mode !== 'side' && afterTag}
          </div>

          {mode === 'side' && (
            <div className="image-compare-stage" {...dragProps}>
              <div className="image-compare-layer">
                <div className="image-compare-frame" style={frame}>
                  <img src={result.url} alt={result.name} draggable={false} />
                </div>
              </div>
              {afterTag}
            </div>
          )}

          {items.length > 1 && (
            <button
              type="button"
              className="image-compare-step"
              onClick={() => onIndex((index + 1) % items.length)}
              aria-label="Next image"
            >
              <span className="material-symbols-outlined" aria-hidden>
                chevron_right
              </span>
            </button>
          )}
        </div>

        <footer className="image-compare-foot">
          <div className="image-compare-zoom" role="group" aria-label="Zoom">
            <button
              type="button"
              className="image-icon-btn"
              onClick={() => applyZoom(1 / 1.25)}
              aria-label="Zoom out"
            >
              <span className="material-symbols-outlined" aria-hidden>
                remove
              </span>
            </button>
            <span className="image-compare-zoom-value">{zoomLabel(scale)}</span>
            <button
              type="button"
              className="image-icon-btn"
              onClick={() => applyZoom(1.25)}
              aria-label="Zoom in"
            >
              <span className="material-symbols-outlined" aria-hidden>
                add
              </span>
            </button>
            <button type="button" className={`image-chip${atFit ? ' on' : ''}`} onClick={reset}>
              Fit
            </button>
            <button
              type="button"
              className={`image-chip${scale === 1 ? ' on' : ''}`}
              onClick={() => setZoom(1)}
            >
              1:1
            </button>
            {mode === 'flip' && (
              <button
                type="button"
                className={`image-chip${showOriginal ? ' on' : ''}`}
                onPointerDown={() => setShowOriginal(true)}
                onPointerUp={() => setShowOriginal(false)}
                onPointerLeave={() => setShowOriginal(false)}
              >
                Hold for original
              </button>
            )}
          </div>

          <p className="image-compare-facts">
            {resized && (
              <span>
                {result.sourceWidth} × {result.sourceHeight} → {result.width} × {result.height}
              </span>
            )}
            {result.attempts > 1 && <span>{result.attempts} encode passes</span>}
            <span>quality {Math.round(result.quality * 100)}%</span>
            {result.warnings.length > 0 && <span className="image-warn">{result.warnings[0]}</span>}
          </p>

          <div className="spacer" />

          <a className="image-btn image-btn-primary" href={result.url} download={result.name}>
            <span className="material-symbols-outlined" aria-hidden>
              download
            </span>
            Download
          </a>
        </footer>
      </div>
    </div>
  )
}

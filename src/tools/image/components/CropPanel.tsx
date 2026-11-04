import { useEffect, useRef, useState } from 'react'
import {
  ASPECTS,
  aspectRatio,
  drawRect,
  moveRect,
  resizeRect,
  resolveCrop,
  sizeRect,
  type Handle,
  type Rect,
} from '../lib/crop'
import { measureSvg } from '../lib/decode'
import type { Size } from '../lib/dimensions'
import type { Pipeline, QueueItem } from '../useImagePipeline'

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** Below this many screen pixels a press on the picture is a click, not a new box. */
const DRAW_THRESHOLD = 4

type Preview = { url: string; natural: Size } | { error: string }

/**
 * The crop box for one image at a time. The picture is a pointer shortcut
 * (aria-hidden); the labelled number fields below it are the real control,
 * and everything either of them does goes through lib/crop.ts.
 */
export function CropPanel({ pipeline }: { pipeline: Pipeline }) {
  const { items, options, setCropAspect, setCropRect, applyCropToAll } = pipeline
  const usable = items.filter((item) => item.status !== 'rejected')
  const [pickedId, setPickedId] = useState<string | null>(null)
  const index = Math.max(0, usable.findIndex((item) => item.id === pickedId))
  const item = usable[index] ?? null
  const preview = usePreview(item)

  const natural = preview && 'natural' in preview ? preview.natural : null
  const ratio = natural ? aspectRatio(options.crop.aspect, natural) : null
  const entry = item ? options.crop.rects[item.id] : undefined
  // Resolved exactly as the worker will resolve it — a crop drawn on another
  // size (apply to all) included — so the box shows what will be cut.
  const committed = natural ? resolveCrop(natural, { aspect: options.crop.aspect, entry: entry ?? null }) : null

  const [draft, setDraft] = useState<Rect | null>(null)
  const rect = draft ?? committed
  const own = Object.keys(options.crop.rects).filter((id) => usable.some((u) => u.id === id)).length

  const commit = (next: Rect) => {
    if (item && natural) setCropRect(item.id, { rect: next, ref: natural })
  }

  return (
    <section className="image-panel image-crop" aria-labelledby="image-panel-crop">
      <h3 id="image-panel-crop">
        <span className="material-symbols-outlined" aria-hidden>
          crop
        </span>
        Crop
      </h3>

      <div className="image-chips" role="group" aria-label="Aspect ratio">
        {ASPECTS.map((aspect) => (
          <button
            key={aspect.id}
            type="button"
            className={`image-chip${options.crop.aspect === aspect.id ? ' on' : ''}`}
            aria-pressed={options.crop.aspect === aspect.id}
            onClick={() => setCropAspect(aspect.id)}
          >
            {aspect.label}
          </button>
        ))}
      </div>

      {!item && <p className="image-note">Add images to place a crop box on each one.</p>}

      {item && (
        <>
          <div className="image-crop-nav">
            {usable.length > 1 && (
              <button
                type="button"
                className="image-icon-btn"
                onClick={() => setPickedId(usable[(index - 1 + usable.length) % usable.length].id)}
                aria-label="Previous image"
              >
                <span className="material-symbols-outlined" aria-hidden>
                  chevron_left
                </span>
              </button>
            )}
            <p className="image-crop-name" aria-live="polite">
              <strong>{item.file.name}</strong>
              {usable.length > 1 && (
                <span className="image-muted">
                  {' '}
                  — {index + 1} of {usable.length}
                </span>
              )}
            </p>
            {usable.length > 1 && (
              <button
                type="button"
                className="image-icon-btn"
                onClick={() => setPickedId(usable[(index + 1) % usable.length].id)}
                aria-label="Next image"
              >
                <span className="material-symbols-outlined" aria-hidden>
                  chevron_right
                </span>
              </button>
            )}
          </div>

          {preview && 'error' in preview && (
            <p className="image-note image-note-warn">{preview.error}</p>
          )}

          {preview && 'url' in preview && rect && (
            <CropStage
              url={preview.url}
              natural={preview.natural}
              rect={rect}
              ratio={ratio}
              onDraft={setDraft}
              onCommit={(next) => {
                setDraft(null)
                commit(next)
              }}
            />
          )}

          {natural && rect && (
            <>
              <div className="image-crop-fields">
                <NumberField
                  label="X"
                  value={rect.x}
                  onChange={(x) => commit(moveRect(rect, x - rect.x, 0, natural))}
                />
                <NumberField
                  label="Y"
                  value={rect.y}
                  onChange={(y) => commit(moveRect(rect, 0, y - rect.y, natural))}
                />
                <NumberField
                  label="Width"
                  value={rect.width}
                  onChange={(width) => commit(sizeRect(rect, { width }, ratio, natural))}
                />
                <NumberField
                  label="Height"
                  value={rect.height}
                  onChange={(height) => commit(sizeRect(rect, { height }, ratio, natural))}
                />
              </div>
              <p className="image-note">
                Image {natural.width} × {natural.height} px, keeping {rect.width} × {rect.height}.{' '}
                {usable.length > 1 &&
                  (own === 0
                    ? 'Images you have not adjusted use the centred crop.'
                    : own === usable.length
                      ? `All ${usable.length} have their own crop.`
                      : `${own} of ${usable.length} have their own crop; the rest use the centred one.`)}{' '}
                The size settings below apply to the cropped area.
              </p>
              <div className="image-crop-actions">
                <button
                  type="button"
                  className="image-btn"
                  disabled={!entry}
                  onClick={() => setCropRect(item.id, null)}
                >
                  Reset this image
                </button>
                {usable.length > 1 && (
                  <button
                    type="button"
                    className="image-btn"
                    onClick={() => applyCropToAll({ rect, ref: natural })}
                  >
                    <span className="material-symbols-outlined" aria-hidden>
                      content_copy
                    </span>
                    Use this crop for all {usable.length}
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}

function CropStage({
  url,
  natural,
  rect,
  ratio,
  onDraft,
  onCommit,
}: {
  url: string
  natural: Size
  rect: Rect
  ratio: number | null
  onDraft: (rect: Rect) => void
  onCommit: (rect: Rect) => void
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    kind: 'slide' | 'stretch' | 'marquee'
    handle: Handle | null
    x: number
    y: number
    scale: number
    start: Rect
    origin: { x: number; y: number }
    last: Rect | null
  } | null>(null)

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !stageRef.current) return
    const box = stageRef.current.getBoundingClientRect()
    if (box.width === 0) return
    const target = event.target as HTMLElement
    const handle = (target.dataset.handle as Handle | undefined) ?? null
    const scale = natural.width / box.width
    drag.current = {
      kind: handle ? 'stretch' : target.closest('.image-crop-box') ? 'slide' : 'marquee',
      handle,
      x: event.clientX,
      y: event.clientY,
      scale,
      start: rect,
      origin: { x: (event.clientX - box.left) * scale, y: (event.clientY - box.top) * scale },
      last: null,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state) return
    const screenX = event.clientX - state.x
    const screenY = event.clientY - state.y
    const dx = screenX * state.scale
    const dy = screenY * state.scale
    let next: Rect
    if (state.kind === 'slide') next = moveRect(state.start, dx, dy, natural)
    else if (state.kind === 'stretch') next = resizeRect(state.start, state.handle!, dx, dy, ratio, natural)
    else {
      if (Math.abs(screenX) < DRAW_THRESHOLD && Math.abs(screenY) < DRAW_THRESHOLD) return
      next = drawRect(state.origin, dx, dy, ratio, natural)
    }
    state.last = next
    onDraft(next)
  }

  const onPointerUp = () => {
    const state = drag.current
    drag.current = null
    if (state?.last) onCommit(state.last)
  }

  const pct = (value: number, of: number) => `${(value / of) * 100}%`
  const box = {
    left: pct(rect.x, natural.width),
    top: pct(rect.y, natural.height),
    width: pct(rect.width, natural.width),
    height: pct(rect.height, natural.height),
  }

  return (
    <div className="image-crop-wrap">
      <div
        className="image-crop-stage"
        ref={stageRef}
        aria-hidden
        style={{
          aspectRatio: `${natural.width} / ${natural.height}`,
          width: `min(100%, calc(60vh * ${natural.width / natural.height}))`,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <img src={url} alt="" draggable={false} />
        {/* the shade is clipped to the picture; the box is not, so handles on
            the picture's edge stay whole and grabbable */}
        <div className="image-crop-shade">
          <div style={box} />
        </div>
        <div className="image-crop-box" style={box}>
          {HANDLES.map((handle) => (
            <span key={handle} className={`image-crop-handle image-crop-${handle}`} data-handle={handle} />
          ))}
        </div>
      </div>
    </div>
  )
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="image-field image-field-inline">
      <span>{label}</span>
      <span className="image-suffix">
        <input
          type="number"
          min={label === 'X' || label === 'Y' ? 0 : 1}
          step={1}
          value={value}
          onChange={(event) => {
            const parsed = Number(event.target.value)
            if (event.target.value.trim() !== '' && Number.isFinite(parsed)) onChange(Math.round(parsed))
          }}
        />
        px
      </span>
    </label>
  )
}

/**
 * An object URL and the size the crop is measured in. A raster's natural size
 * is its decoded, EXIF-rotated size — the same one the worker's bitmap has.
 * An SVG is measured the way the pipeline measures it.
 */
function usePreview(item: QueueItem | null): Preview | null {
  const [preview, setPreview] = useState<Preview | null>(null)
  const file = item?.file ?? null
  const svg = item?.source === 'svg'

  useEffect(() => {
    setPreview(null)
    if (!file) return
    let alive = true
    const url = URL.createObjectURL(file)
    ;(async () => {
      try {
        // the load event, not img.decode(): decode() can stay pending in a
        // page the browser is not painting, and the panel would never appear
        const img = new Image()
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve()
          img.onerror = () => reject(new Error('no preview'))
          img.src = url
        })
        let natural: Size
        if (svg) {
          const measured = await measureSvg(file)
          natural = {
            width: Math.max(1, Math.round(measured.intrinsic.width)),
            height: Math.max(1, Math.round(measured.intrinsic.height)),
          }
        } else {
          natural = { width: img.naturalWidth, height: img.naturalHeight }
        }
        if (!natural.width || !natural.height) throw new Error('no size')
        if (alive) setPreview({ url, natural })
      } catch {
        if (alive) {
          setPreview({
            error: 'This browser cannot draw a preview of this file, so it will use the centred crop.',
          })
        }
      }
    })()
    return () => {
      alive = false
      URL.revokeObjectURL(url)
    }
  }, [file, svg])

  return preview
}

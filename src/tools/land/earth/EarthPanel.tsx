import { useMemo, useRef, useState, type DragEvent } from 'react'
import { label } from '../plot/model'
import { ellipsoidArea, project, sideLengths } from './geodesy'
import type { Shape, ShapesRead } from './kml'

export interface EarthData {
  fileName: string
  read: ShapesRead
  selected: number
}

interface Props {
  data: EarthData | null
  error: string
  loading: boolean
  onFile: (file: File) => void
  onSelect: (index: number) => void
  onSketch: (shape: Shape) => void
}

const FOOT = 0.3048
const fmt = (v: number, digits = 2) => v.toLocaleString('en-US', { maximumFractionDigits: digits })

/** The outline north-up, to scale, with holes and corner letters. */
function Outline({ shape }: { shape: Shape }) {
  const rings = project(shape.rings)
  const all = rings.flat()
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1])
  const minX = Math.min(...xs), maxY = Math.max(...ys)
  const span = Math.max(Math.max(...xs) - minX, maxY - Math.min(...ys)) || 1
  const k = 260 / span
  const view = rings.map((r) => r.map(([x, y]) => [24 + (x - minX) * k, 24 + (maxY - y) * k]))
  const w = (Math.max(...xs) - minX) * k + 48, h = (maxY - Math.min(...ys)) * k + 48
  const outer = view[0]
  const cx = outer.reduce((a, p) => a + p[0], 0) / outer.length, cy = outer.reduce((a, p) => a + p[1], 0) / outer.length
  return (
    <figure className="land-measured land-earth-outline">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Outline of ${shape.name}, north up, to scale`}>
        <path d={view.map((r) => `M${r.map((p) => p.join(' ')).join('L')}Z`).join('')} fillRule="evenodd" />
        {outer.length <= 26 && outer.map(([x, y], i) => {
          const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1
          return <text key={i} x={x + (dx / d) * 12} y={y + (dy / d) * 12 + 4}>{label(i)}</text>
        })}
      </svg>
      <figcaption>North up, to scale</figcaption>
    </figure>
  )
}

export function EarthPanel({ data, error, loading, onFile, onSelect, onSketch }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const shape = data?.read.shapes[data.selected]
  const areas = useMemo(() => data?.read.shapes.map((s) => ellipsoidArea(s.rings)) ?? [], [data])
  const sides = useMemo(() => (shape ? sideLengths(shape.rings[0]) : []), [shape])

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) onFile(file)
  }

  const sketchBlocked = shape
    ? shape.rings.length > 1 ? 'The sketch has no holes, so a shape with holes stays here.'
      : shape.rings[0].length / 2 > 26 ? 'The sketch takes up to 26 corners.' : ''
    : ''

  return (
    <div className="land-earth">
      <div
        className={`land-earth-drop${dragging ? ' dragging' : ''}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
      >
        <span className="material-symbols-outlined" aria-hidden>upload_file</span>
        <p>{data ? <><b>{data.fileName}</b> · read in this browser, not uploaded</> : <>Drop a <b>.kml</b> or <b>.kmz</b> from Google Earth here</>}</p>
        <button className="land-primary" onClick={() => fileRef.current?.click()}>{data ? 'Choose another file' : 'Choose file'}</button>
        <input ref={fileRef} type="file" accept=".kml,.kmz" hidden onChange={(event) => { const f = event.target.files?.[0]; if (f) onFile(f); event.target.value = '' }} />
      </div>

      {!data && !error && (
        <ol className="land-earth-steps">
          <li>In Google Earth Pro, zoom to the plot and choose <b>Add → Polygon</b>. Click each corner of the plot, then OK.</li>
          <li>Right-click the polygon in Places and choose <b>Save Place As…</b>, as KML or KMZ. (In Google Earth on the web: draw the shape in a project, then export the project as KML.)</li>
          <li>Drop the file here. Its area is measured on the earth’s surface (WGS84), on your device.</li>
        </ol>
      )}
      {loading && <p className="land-hint" role="status">Reading…</p>}
      {error && <p className="land-error" role="alert">{error}</p>}

      {data && (
        <>
          {data.read.shapes.length > 1 && (
            <fieldset className="land-earth-list">
              <legend>Shapes in the file</legend>
              {data.read.shapes.map((s, i) => (
                <label key={i}>
                  <input type="radio" name="land-earth-shape" checked={data.selected === i} onChange={() => onSelect(i)} />
                  <span>{s.name}{s.folder && <small> · {s.folder}</small>}</span>
                  <span className="land-earth-area">{fmt(areas[i])} m²</span>
                </label>
              ))}
            </fieldset>
          )}

          {shape && (
            <div className="land-plot-done">
              <Outline shape={shape} />
              <div>
                <p className="land-plot-area"><b>{shape.name}</b> · {fmt(areas[data.selected])} m² · {fmt(areas[data.selected] / (FOOT * FOOT))} ft²</p>
                <table className="land-earth-sides">
                  <caption className="land-sr">Side lengths of the outline</caption>
                  <thead><tr><th scope="col">Side</th><th scope="col">ft</th><th scope="col">m</th></tr></thead>
                  <tbody>
                    {sides.length <= 26 && sides.map((m, i) => (
                      <tr key={i}><th scope="row">{label(i)}–{label((i + 1) % sides.length)}</th><td>{fmt(m / FOOT)}</td><td>{fmt(m)}</td></tr>
                    ))}
                    <tr className="total"><th scope="row">Perimeter</th><td>{fmt(sides.reduce((a, b) => a + b, 0) / FOOT)}</td><td>{fmt(sides.reduce((a, b) => a + b, 0))}</td></tr>
                  </tbody>
                </table>
                {shape.rings.length > 1 && <p className="land-hint">{shape.rings.length - 1} hole{shape.rings.length > 2 ? 's' : ''} subtracted from the area.</p>}
                <div className="land-earth-actions">
                  <button onClick={() => onSketch(shape)} disabled={Boolean(sketchBlocked)}>Edit as sketch</button>
                  <span className="land-hint">{sketchBlocked || 'Opens the outline in the sketch with these lengths and diagonals from A, so you can replace any with a tape measurement.'}</span>
                </div>
              </div>
            </div>
          )}

          {!data.read.shapes.length && (
            <p className="land-need">No closed shapes in this file{data.read.paths.length ? ` — only path${data.read.paths.length > 1 ? 's' : ''} (${data.read.paths.slice(0, 3).join(', ')}), which have no area. Draw the plot with Add → Polygon instead of Add → Path` : data.read.points ? ' — only placemark pins. Draw the plot with Add → Polygon' : ''}.</p>
          )}
          {data.read.shapes.length > 0 && data.read.paths.length > 0 && (
            <p className="land-hint">Skipped {data.read.paths.length} open path{data.read.paths.length > 1 ? 's' : ''} ({data.read.paths.slice(0, 3).join(', ')}{data.read.paths.length > 3 ? ', …' : ''}) — a path has no area unless it ends where it starts.</p>
          )}
          {data.read.badCoordinates > 0 && <p className="land-hint">{data.read.badCoordinates} coordinate{data.read.badCoordinates > 1 ? 's' : ''} could not be read and {data.read.badCoordinates > 1 ? 'were' : 'was'} left out.</p>}
          <p className="land-hint">Measured on the WGS84 ellipsoid from the outline as drawn (checked against pyproj’s geodesic area). Google Earth’s own ruler can read a few tenths of a percent higher, and a CAD drawing in UTM a few hundredths of a percent lower — different models of the earth, same outline. Satellite imagery can be off by a metre or more and plot edges are hard to see, so treat this as an estimate — the land office’s measurement is the record.</p>
        </>
      )}
    </div>
  )
}

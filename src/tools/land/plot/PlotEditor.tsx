import { useMemo, useRef, useState, type PointerEvent } from 'react'
import {
  addCorner, addDiagonal, adjacent, close, EMPTY_PLOT, label, moveCorner, removeDiagonal, setAngle, setDiagonal, setSide,
  SKETCH_H, SKETCH_W, sideCount, sideName, template, undo, type Plot,
} from './model'
import type { LengthUnit, Solved, Unsolved } from './solve'

interface Props {
  plot: Plot
  unit: LengthUnit
  result: Solved | Unsolved
  onChange: (plot: Plot) => void
  onUnit: (unit: LengthUnit) => void
}

type Tool = 'corner' | 'diagonal'

const fmt = (v: number, digits = 2) => v.toLocaleString('en-US', { maximumFractionDigits: digits })

function signedArea(points: [number, number][]) {
  let s = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) s += points[j][0] * points[i][1] - points[i][0] * points[j][1]
  return s / 2
}

/** The true shape, to scale, turned so side A–B runs the way it does in the sketch. */
function MeasuredShape({ coords, sketch }: { coords: [number, number][]; sketch: [number, number][] }) {
  const turn = Math.atan2(sketch[1][1] - sketch[0][1], sketch[1][0] - sketch[0][0]) - Math.atan2(coords[1][1] - coords[0][1], coords[1][0] - coords[0][0])
  const c = Math.cos(turn), s = Math.sin(turn)
  const pts = coords.map(([x, y]) => [x * c - y * s, x * s + y * c])
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const minX = Math.min(...xs), minY = Math.min(...ys)
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1
  const k = 260 / span
  const view = pts.map(([x, y]) => [20 + (x - minX) * k, 20 + (y - minY) * k])
  const w = (Math.max(...xs) - minX) * k + 40, h = (Math.max(...ys) - minY) * k + 40
  const cx = view.reduce((a, p) => a + p[0], 0) / view.length, cy = view.reduce((a, p) => a + p[1], 0) / view.length
  return (
    <figure className="land-measured">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="The plot drawn to scale from the measurements">
        <polygon points={view.map((p) => p.join(',')).join(' ')} />
        {view.map(([x, y], i) => {
          const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1
          return <text key={i} x={x + (dx / d) * 11} y={y + (dy / d) * 11 + 4}>{label(i)}</text>
        })}
      </svg>
      <figcaption>To scale, from your measurements</figcaption>
    </figure>
  )
}

export function PlotEditor({ plot, unit, result, onChange, onUnit }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<number | null>(null)
  const [tool, setTool] = useState<Tool>('corner')
  const [from, setFrom] = useState<number | null>(null)
  const [pairA, setPairA] = useState(0)
  const [pairB, setPairB] = useState(2)
  const n = plot.points.length
  const sides = sideCount(plot)
  const bad = result.ok ? null : result.bad

  const toSvg = (event: PointerEvent): [number, number] => {
    const svg = svgRef.current
    const m = svg?.getScreenCTM()
    if (!svg || !m) return [0, 0]
    const pt = new DOMPoint(event.clientX, event.clientY).matrixTransform(m.inverse())
    return [pt.x, pt.y]
  }

  const focusField = (id: string) => {
    // Focus after React has rendered the field (it may be new).
    requestAnimationFrame(() => document.getElementById(id)?.focus())
  }

  const onBackground = (event: PointerEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget && !(event.target as Element).classList.contains('land-sketch-bg')) return
    if (tool !== 'corner' || plot.closed) return
    const [x, y] = toSvg(event)
    onChange(addCorner(plot, x, y))
  }

  const onCorner = (event: PointerEvent, i: number) => {
    event.stopPropagation()
    if (tool === 'diagonal') {
      if (from === null) { setFrom(i); return }
      if (!adjacent(plot, from, i)) {
        const next = addDiagonal(plot, from, i)
        onChange(next)
        const index = next.diagonals.findIndex((d) => d.a === Math.min(from, i) && d.b === Math.max(from, i))
        if (index >= 0) focusField(`land-diag-${index}`)
      }
      setFrom(null)
      return
    }
    if (!plot.closed && i === 0 && n >= 3) {
      onChange(close(plot))
      focusField('land-side-0')
      return
    }
    drag.current = i
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    if (drag.current === null) return
    const [x, y] = toSvg(event)
    onChange(moveCorner(plot, drag.current, x, y))
  }

  const endDrag = () => { drag.current = null }

  const winding = Math.sign(signedArea(plot.points)) || 1
  const centroid = useMemo(() => {
    if (!n) return [SKETCH_W / 2, SKETCH_H / 2]
    return [plot.points.reduce((a, p) => a + p[0], 0) / n, plot.points.reduce((a, p) => a + p[1], 0) / n]
  }, [plot.points, n])

  const edgeLabel = (a: [number, number], b: [number, number], outward: boolean) => {
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
    const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1
    // Outside the outline for sides, beside the line for diagonals.
    const side = outward ? winding : 1
    return [mx + (side * dy * 18) / d, my - (side * dx * 18) / d + 6]
  }

  const lengthText = (text: string) => (text.trim() ? `${text.trim()}${/['"a-z]/i.test(text) ? '' : ` ${unit}`}` : '?')

  return (
    <div className="land-plot">
      <div className="land-plot-bar">
        <div className="land-seg" role="group" aria-label="Sketch tool">
          <button className={tool === 'corner' ? 'on' : ''} aria-pressed={tool === 'corner'} onClick={() => { setTool('corner'); setFrom(null) }}>Corners</button>
          <button className={tool === 'diagonal' ? 'on' : ''} aria-pressed={tool === 'diagonal'} disabled={!plot.closed} onClick={() => setTool('diagonal')}>Diagonal</button>
        </div>
        <button onClick={() => { onChange(undo(plot)); setFrom(null) }} disabled={!n}>Undo</button>
        <button onClick={() => { onChange(EMPTY_PLOT); setTool('corner'); setFrom(null) }} disabled={!n}>Clear</button>
        <label className="land-plot-start">
          <span>Start from</span>
          <select value="" onChange={(event) => { if (event.target.value) { onChange(template(Number(event.target.value))); setTool('corner'); setFrom(null) } }} aria-label="Start from a shape">
            <option value="">…</option>
            <option value="3">Triangle</option>
            <option value="4">Rectangle (square corners)</option>
            <option value="5">5 corners</option>
            <option value="6">6 corners</option>
            <option value="8">8 corners</option>
          </select>
        </label>
        <div className="land-seg" role="group" aria-label="Length unit">
          {(['ft', 'm'] as const).map((u) => (
            <button key={u} className={unit === u ? 'on' : ''} aria-pressed={unit === u} onClick={() => onUnit(u)}>{u === 'ft' ? 'feet' : 'metres'}</button>
          ))}
        </div>
      </div>

      <div className="land-plot-grid">
        <div className="land-sketch-wrap">
          {/* A pointer shortcut: every measurement is also in the list beside it. */}
          <svg
            ref={svgRef}
            className={`land-sketch tool-${tool}${plot.closed ? ' closed' : ''}`}
            viewBox={`0 0 ${SKETCH_W} ${SKETCH_H}`}
            aria-hidden="true"
            onPointerDown={onBackground}
            onPointerMove={onMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <defs>
              <pattern id="land-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" /></pattern>
            </defs>
            <rect className="land-sketch-bg" width={SKETCH_W} height={SKETCH_H} fill="url(#land-grid)" />
            {n > 1 && (plot.closed
              ? <polygon className="land-shape" points={plot.points.map((p) => p.join(',')).join(' ')} />
              : <polyline className="land-shape open" points={plot.points.map((p) => p.join(',')).join(' ')} />)}
            {plot.diagonals.map((d, i) => {
              const a = plot.points[d.a], b = plot.points[d.b]
              const [lx, ly] = edgeLabel(a, b, false)
              return (
                <g key={`d${d.a}-${d.b}`} className={`land-diag${bad?.diagonals.includes(i) ? ' bad' : ''}`} onPointerDown={(e) => { e.stopPropagation(); focusField(`land-diag-${i}`) }}>
                  <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
                  <line className="hit" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
                  <text x={lx} y={ly}>{lengthText(d.length)}</text>
                </g>
              )
            })}
            {Array.from({ length: sides }, (_, i) => {
              const a = plot.points[i], b = plot.points[(i + 1) % n]
              const [lx, ly] = edgeLabel(a, b, true)
              const missing = !plot.sides[i]?.trim()
              return (
                <g key={`s${i}`} className={`land-side${bad?.sides.includes(i) ? ' bad' : ''}${missing ? ' missing' : ''}`} onPointerDown={(e) => { e.stopPropagation(); focusField(`land-side-${i}`) }}>
                  <line className="hit" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
                  <text x={lx} y={ly}>{lengthText(plot.sides[i] ?? '')}</text>
                </g>
              )
            })}
            {plot.points.map(([x, y], i) => {
              const angle = plot.angles[i]?.trim()
              const dx = centroid[0] - x, dy = centroid[1] - y, d = Math.hypot(dx, dy) || 1
              const closer = !plot.closed && i === 0 && n >= 3 && tool === 'corner'
              return (
                <g key={`p${i}`} className={`land-corner${from === i ? ' from' : ''}${closer ? ' closer' : ''}`} onPointerDown={(e) => onCorner(e, i)}>
                  <circle cx={x} cy={y} r={closer ? 11 : 7} />
                  <text className="name" x={x - (dx / d) * 20} y={y - (dy / d) * 20 + 6}>{label(i)}</text>
                  {angle && <text className={`angle${bad?.angles.includes(i) ? ' bad' : ''}`} x={x + (dx / d) * 30} y={y + (dy / d) * 30 + 6}>{angle}°</text>}
                </g>
              )
            })}
            {!n && <text className="land-sketch-hint" x={SKETCH_W / 2} y={SKETCH_H / 2}>Click to place the plot’s corners in order</text>}
          </svg>
          <p className="land-hint">
            {tool === 'diagonal'
              ? from === null ? 'Click a corner, then the corner opposite it.' : `Diagonal from ${label(from)} — click the other corner.`
              : plot.closed
                ? 'Drag corners to tidy the sketch — only their order matters. Click a side to type its length.'
                : n >= 3 ? 'Keep clicking to add corners; click A to close the outline.' : 'Click to add corners in order around the plot.'}
          </p>
        </div>

        <div className="land-measures">
          {sides > 0 && (
            <fieldset>
              <legend>Sides ({unit === 'ft' ? 'feet, or 30\'6"' : 'metres'})</legend>
              {Array.from({ length: sides }, (_, i) => (
                <label key={i} className="land-measure">
                  <span>{sideName(plot, i)}</span>
                  <input id={`land-side-${i}`} value={plot.sides[i] ?? ''} inputMode="decimal" autoComplete="off" placeholder="length" aria-invalid={bad?.sides.includes(i)} onChange={(e) => onChange(setSide(plot, i, e.target.value))} />
                </label>
              ))}
            </fieldset>
          )}
          {plot.closed && (
            <fieldset>
              <legend>Diagonals</legend>
              {plot.diagonals.map((d, i) => (
                <div key={`${d.a}-${d.b}`} className="land-measure">
                  <label htmlFor={`land-diag-${i}`}>{label(d.a)}–{label(d.b)}</label>
                  <input id={`land-diag-${i}`} value={d.length} inputMode="decimal" autoComplete="off" placeholder="length" aria-invalid={bad?.diagonals.includes(i)} onChange={(e) => onChange(setDiagonal(plot, i, e.target.value))} />
                  <button onClick={() => onChange(removeDiagonal(plot, i))} aria-label={`Remove diagonal ${label(d.a)}–${label(d.b)}`} title="Remove"><span className="material-symbols-outlined" aria-hidden>close</span></button>
                </div>
              ))}
              {n >= 4 && (
                <div className="land-add-diag">
                  <select value={pairA} onChange={(e) => setPairA(Number(e.target.value))} aria-label="Diagonal from corner">
                    {plot.points.map((_, i) => <option key={i} value={i}>{label(i)}</option>)}
                  </select>
                  <span aria-hidden>–</span>
                  <select value={pairB} onChange={(e) => setPairB(Number(e.target.value))} aria-label="Diagonal to corner">
                    {plot.points.map((_, i) => <option key={i} value={i}>{label(i)}</option>)}
                  </select>
                  <button disabled={pairA >= n || pairB >= n || adjacent(plot, pairA, pairB)} onClick={() => onChange(addDiagonal(plot, pairA, pairB))}>Add diagonal</button>
                </div>
              )}
            </fieldset>
          )}
          {plot.closed && (
            <fieldset>
              <legend>Corner angles (inside, degrees)</legend>
              {plot.points.map((_, i) => (
                <div key={i} className="land-measure">
                  <label htmlFor={`land-angle-${i}`}>{label(i)}</label>
                  <input id={`land-angle-${i}`} value={plot.angles[i] ?? ''} inputMode="decimal" autoComplete="off" placeholder="—" aria-invalid={bad?.angles.includes(i)} onChange={(e) => onChange(setAngle(plot, i, e.target.value))} />
                  <button className={plot.angles[i] === '90' ? 'on' : ''} aria-pressed={plot.angles[i] === '90'} onClick={() => onChange(setAngle(plot, i, plot.angles[i] === '90' ? '' : '90'))} aria-label={`Square corner at ${label(i)}`} title="Square corner">90°</button>
                </div>
              ))}
            </fieldset>
          )}
        </div>
      </div>

      <div className="land-plot-status" role="status">
        {!result.ok && <p className={n >= 3 && plot.closed ? 'land-need' : 'land-hint'}>{result.message}</p>}
        {result.ok && (
          <div className="land-plot-done">
            <MeasuredShape coords={result.coords} sketch={plot.points} />
            <div>
              <p className="land-plot-area"><b>{fmt(result.area)} {unit === 'ft' ? 'ft²' : 'm²'}</b> · perimeter {fmt(result.perimeter)} {unit}</p>
              {result.crossing && <p className="land-warn">The outline crosses itself in the measured shape — check the order of the corners and the diagonals.</p>}
              {result.conflicts.length > 0 && (
                <div className="land-warn">
                  <p>Some measurements disagree with the shape the others give, so the area depends on which ones are right:</p>
                  <ul>
                    {result.conflicts.map((c) => (
                      <li key={c.what}>{c.what}: measured {fmt(c.measured)}{c.what.startsWith('angle') ? '°' : ` ${unit}`}, the rest give {fmt(c.implied)}{c.what.startsWith('angle') ? '°' : ` ${unit}`}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

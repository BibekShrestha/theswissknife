import type { DNode } from '../types'
import { hexOffset } from '../util'
import { activeView, displayOf, type ViewChoice } from './model'

interface DetailsProps {
  node: DNode
  id: string
  choice: ViewChoice
  onChoose: (view: number) => void
  onCopy: (text: string, what: string) => void
}

const range = (start: number, end: number) => `${hexOffset(start)}–${hexOffset(Math.max(start, end - 1))} (${start}–${Math.max(start, end - 1)})`

/** Everything about the selected item: its bytes, every reading, the readings to switch between, and its notes. */
export function Details({ node, id, choice, onChoose, onCopy }: DetailsProps) {
  const { value, kind } = displayOf(node, id, choice)
  const current = activeView(node, id, choice)
  const length = node.end - node.start
  return (
    <div className="bin-details">
      <div className="bin-details-head">
        <h3>{node.label || 'item'}</h3>
        <span className="bin-kind">{kind}</span>
        {value && (
          <button type="button" onClick={() => onCopy(value, 'Value')} aria-label="Copy value" title="Copy value">
            <span className="material-symbols-outlined" aria-hidden>content_copy</span>
          </button>
        )}
      </div>
      {value && <pre className="bin-details-value">{value}</pre>}

      {node.views && node.views.length > 1 && (
        <div className="bin-views" role="group" aria-label="Read these bytes as">
          <span>Read as</span>
          {node.views.map((view, i) => (
            <button key={view.name} type="button" className={i === current ? 'on' : ''} aria-pressed={i === current} onClick={() => onChoose(i)}>
              {view.name}
            </button>
          ))}
        </div>
      )}

      <dl className="bin-facts">
        <dt>Bytes</dt>
        <dd>{length ? range(node.start, node.end) : `${hexOffset(node.start)} (empty)`} · {length.toLocaleString('en-US')} {length === 1 ? 'byte' : 'bytes'}</dd>
        <dt>Header</dt>
        <dd>{node.head - node.start} {node.head - node.start === 1 ? 'byte' : 'bytes'}, then {node.end - node.head} of content</dd>
        {node.key && (
          <>
            <dt>Key</dt>
            <dd><code>{node.key.value ?? node.key.kind}</code> · {node.key.kind} · {range(node.key.start, node.key.end)}</dd>
          </>
        )}
        {node.readings?.map((r) => (
          <FactRow key={r.name} name={r.name} value={r.value} />
        ))}
        {node.views?.filter((_, i) => i !== current).map((view) => (
          <FactRow key={view.name} name={`as ${view.name}`} value={view.value} />
        ))}
      </dl>

      {node.notes && node.notes.length > 0 && (
        <ul className="bin-notes">
          {node.notes.map((n, i) => (
            <li key={i} className={n.level}>
              <span className="material-symbols-outlined" aria-hidden>{n.level === 'warn' ? 'warning' : 'info'}</span>
              <span><span className="bin-sr">{n.level === 'warn' ? 'Warning: ' : 'Note: '}</span>{n.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FactRow({ name, value }: { name: string; value: string }) {
  return (
    <>
      <dt>{name}</dt>
      <dd><code>{value.length > 400 ? `${value.slice(0, 400)}…` : value}</code></dd>
    </>
  )
}

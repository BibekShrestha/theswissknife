import { useState } from 'react'
import { CompareViewer } from './CompareViewer'
import { formatBytes } from '../lib/naming'
import type { Pipeline } from '../useImagePipeline'

export function ItemList({ pipeline }: { pipeline: Pipeline }) {
  const { items, results, totals, running, removeItem, clearAll, downloadOne, downloadAll } = pipeline
  // index into `results`, so the viewer can step through the whole batch
  const [compare, setCompare] = useState<number | null>(null)

  if (items.length === 0) return null

  return (
    <section className="image-items" aria-label="Queue">
      <header className="image-items-head">
        <h3>
          {items.length} file{items.length === 1 ? '' : 's'}
          {results.length > 0 && (
            <span className="image-items-saved">
              {formatBytes(totals.before)} → {formatBytes(totals.after)}
              {totals.saved > 0.005 && (
                <em className="image-good"> −{Math.round(totals.saved * 100)}%</em>
              )}
              {totals.saved < -0.005 && (
                <em className="image-warn"> +{Math.round(-totals.saved * 100)}%</em>
              )}
            </span>
          )}
        </h3>
        <div className="spacer" />
        {results.length > 0 && (
          <button type="button" className="image-btn image-btn-primary" onClick={downloadAll}>
            <span className="material-symbols-outlined" aria-hidden>
              download
            </span>
            {results.length > 1 ? `Download all (${results.length}) as zip` : 'Download'}
          </button>
        )}
        <button type="button" className="image-btn" onClick={clearAll} disabled={running}>
          Clear
        </button>
      </header>

      <ul className="image-item-rows">
        {items.map((item) => (
          <li key={item.id} className="image-item" data-status={item.status}>
            <button
              type="button"
              className="image-thumb"
              onClick={() => {
                const at = results.findIndex((candidate) => candidate.id === item.id)
                if (at >= 0) setCompare(at)
              }}
              disabled={!item.result}
              aria-label={item.result ? `Compare ${item.result.name} with the original` : 'Nothing to compare yet'}
            >
              {item.result ? (
                <>
                  <img src={item.result.url} alt="" />
                  <span className="image-thumb-hint material-symbols-outlined" aria-hidden>
                    compare
                  </span>
                </>
              ) : (
                <span className="material-symbols-outlined" aria-hidden>
                  {item.status === 'rejected' ? 'block' : 'image'}
                </span>
              )}
            </button>

            <div className="image-item-body">
              <p className="image-item-name">{item.result?.name ?? item.file.name}</p>
              <p className="image-item-meta">
                <span className="image-tag">{item.source.toUpperCase()}</span>
                {item.result && (
                  <>
                    <span className="material-symbols-outlined image-arrow" aria-hidden>
                      arrow_right_alt
                    </span>
                    <span className="image-tag">{item.result.format.toUpperCase()}</span>
                    <span>
                      {item.result.sourceWidth !== item.result.width ||
                      item.result.sourceHeight !== item.result.height
                        ? `${item.result.sourceWidth} × ${item.result.sourceHeight} → ${item.result.width} × ${item.result.height} px`
                        : `${item.result.width} × ${item.result.height} px`}
                    </span>
                    <span>
                      {formatBytes(item.file.size)} → <strong>{formatBytes(item.result.bytes)}</strong>
                      {savedLabel(item.file.size, item.result.bytes)}
                    </span>
                    {item.result.attempts > 1 && (
                      <span className="image-muted">{item.result.attempts} passes</span>
                    )}
                  </>
                )}
                {!item.result && <span>{formatBytes(item.file.size)}</span>}
                {item.status === 'working' && <span className="image-muted">working…</span>}
                {item.status === 'queued' && <span className="image-muted">queued</span>}
              </p>

              {item.error && <p className="image-item-error">{item.error}</p>}
              {item.result?.warnings.map((warning) => (
                <p key={warning} className="image-item-warning">
                  <span className="material-symbols-outlined" aria-hidden>
                    info
                  </span>
                  {warning}
                </p>
              ))}
            </div>

            <div className="image-item-actions">
              {item.result && (
                <>
                  <button
                    type="button"
                    className="image-icon-btn"
                    onClick={() => {
                      const at = results.findIndex((candidate) => candidate.id === item.id)
                      if (at >= 0) setCompare(at)
                    }}
                    aria-label={`Compare ${item.result.name} with the original`}
                  >
                    <span className="material-symbols-outlined" aria-hidden>
                      compare
                    </span>
                  </button>
                  <button
                    type="button"
                    className="image-icon-btn"
                    onClick={() => downloadOne(item)}
                    aria-label={`Download ${item.result.name}`}
                  >
                    <span className="material-symbols-outlined" aria-hidden>
                      download
                    </span>
                  </button>
                </>
              )}
              <button
                type="button"
                className="image-icon-btn"
                onClick={() => removeItem(item.id)}
                disabled={running}
                aria-label={`Remove ${item.file.name}`}
              >
                <span className="material-symbols-outlined" aria-hidden>
                  close
                </span>
              </button>
            </div>
          </li>
        ))}
      </ul>

      {compare !== null && results[compare] && (
        <CompareViewer
          items={results}
          index={compare}
          onIndex={setCompare}
          onClose={() => setCompare(null)}
        />
      )}
    </section>
  )
}

function savedLabel(before: number, after: number) {
  if (before <= 0) return null
  const change = 1 - after / before
  if (Math.abs(change) < 0.005) return null
  return change > 0 ? (
    <em className="image-good"> −{Math.round(change * 100)}%</em>
  ) : (
    <em className="image-warn"> +{Math.round(-change * 100)}%</em>
  )
}

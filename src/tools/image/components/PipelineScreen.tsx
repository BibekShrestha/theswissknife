import type { ScreenMeta } from '../lib/screens'
import { useImagePipeline } from '../useImagePipeline'
import { Dropzone } from './Dropzone'
import { ItemList } from './ItemList'
import { Panels } from './Panels'

/**
 * Every screen is this component with a different `screen` — the panels and the
 * starting options are all that change between Convert, Resize, Compress and
 * All in one.
 */
export function PipelineScreen({ screen }: { screen: ScreenMeta }) {
  const pipeline = useImagePipeline(screen.defaults)
  const { items, pending, running, completed, notice, run, cancel, addFiles } = pipeline

  return (
    <div className="image-screen">
      <header className="image-screen-head">
        <span className="image-screen-icon" style={{ background: `${screen.color}22`, color: screen.color }}>
          <span className="material-symbols-outlined" aria-hidden>
            {screen.icon}
          </span>
        </span>
        <div>
          <h2>{screen.name}</h2>
          <p>{screen.description}</p>
        </div>
      </header>

      <Dropzone count={items.length} disabled={running} onFiles={addFiles} />

      {notice && (
        <p className="image-note image-note-warn" role="status">
          {notice}
        </p>
      )}

      <Panels panels={screen.panels} pipeline={pipeline} />

      <div className="image-run">
        <button
          type="button"
          className="image-btn image-btn-primary image-btn-lg"
          disabled={pending === 0 || running}
          onClick={run}
        >
          <span className="material-symbols-outlined" aria-hidden>
            {running ? 'progress_activity' : 'auto_awesome'}
          </span>
          {running
            ? `Working — ${completed} of ${pending}`
            : pending > 1
              ? `Process ${pending} images`
              : 'Process image'}
        </button>
        {running && (
          <button type="button" className="image-btn" onClick={cancel}>
            Cancel
          </button>
        )}
        {running && (
          <div className="image-progress" role="progressbar" aria-valuemin={0} aria-valuemax={pending} aria-valuenow={completed}>
            <div style={{ width: `${pending > 0 ? (completed / pending) * 100 : 0}%` }} />
          </div>
        )}
      </div>

      <ItemList pipeline={pipeline} />
    </div>
  )
}

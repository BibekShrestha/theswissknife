import { formatInfo, OUT_FORMATS, type FormatChoice } from '../lib/formats'
import type { PanelId } from '../lib/screens'
import type { Pipeline } from '../useImagePipeline'

export function Panels({ panels, pipeline }: { panels: PanelId[]; pipeline: Pipeline }) {
  return (
    <div className="image-panels">
      {panels.map((panel) =>
        panel === 'format' ? (
          <FormatPanel key={panel} pipeline={pipeline} />
        ) : panel === 'resize' ? (
          <ResizePanel key={panel} pipeline={pipeline} />
        ) : (
          <TargetPanel key={panel} pipeline={pipeline} />
        ),
      )}
    </div>
  )
}

function FormatPanel({ pipeline }: { pipeline: Pipeline }) {
  const { options, setOption, encoders } = pipeline
  const choice = options.format
  const info = choice === 'keep' ? null : formatInfo(choice)
  // With "keep original" the output format varies per file, so show the dials
  // that could apply to any lossy result.
  const showQuality = choice === 'keep' || info?.quality === true
  const showMatte = info != null && !info.alpha
  const showGif = choice === 'gif'

  return (
    <section className="image-panel" aria-labelledby="image-panel-format">
      <h3 id="image-panel-format">
        <span className="material-symbols-outlined" aria-hidden>
          image
        </span>
        Output format
      </h3>

      <div className="image-chips" role="group" aria-label="Output format">
        <Chip
          on={choice === 'keep'}
          label="Keep original"
          onClick={() => setOption('format', 'keep' as FormatChoice)}
        />
        {OUT_FORMATS.filter((format) => encoders.includes(format.id)).map((format) => (
          <Chip
            key={format.id}
            on={choice === format.id}
            label={format.label}
            onClick={() => setOption('format', format.id)}
          />
        ))}
      </div>

      {info?.note && <p className="image-note">{info.note}</p>}
      {choice === 'keep' && (
        <p className="image-note">
          Each file is re-encoded as what it already was. SVG has no raster equivalent, so an SVG
          input becomes PNG.
        </p>
      )}

      {showQuality && (
        <label className="image-field">
          <span>Quality — {Math.round(options.quality * 100)}%</span>
          <input
            type="range"
            min={10}
            max={100}
            step={1}
            value={Math.round(options.quality * 100)}
            onChange={(e) => setOption('quality', Number(e.target.value) / 100)}
          />
        </label>
      )}

      {showMatte && (
        <label className="image-field image-field-inline">
          <span>Background for transparent pixels</span>
          <input
            type="color"
            value={options.matte}
            onChange={(e) => setOption('matte', e.target.value)}
          />
        </label>
      )}

      {showGif && (
        <div className="image-field-row">
          <label className="image-field">
            <span>Colours — {options.gifColors}</span>
            <input
              type="range"
              min={2}
              max={256}
              step={1}
              value={options.gifColors}
              onChange={(e) => setOption('gifColors', Number(e.target.value))}
            />
          </label>
          <label className="image-check">
            <input
              type="checkbox"
              checked={options.gifDither}
              onChange={(e) => setOption('gifDither', e.target.checked)}
            />
            <span>Dither (smoother gradients, slightly larger file)</span>
          </label>
        </div>
      )}
    </section>
  )
}

const PERCENT_PRESETS = [25, 50, 75]
const LONGEST_PRESETS = [640, 1024, 1920, 2560]

function ResizePanel({ pipeline }: { pipeline: Pipeline }) {
  const { options, setResize } = pipeline
  const { resize } = options

  return (
    <section className="image-panel" aria-labelledby="image-panel-resize">
      <h3 id="image-panel-resize">
        <span className="material-symbols-outlined" aria-hidden>
          aspect_ratio
        </span>
        Size
      </h3>

      <div className="image-chips" role="group" aria-label="Resize mode">
        <Chip on={resize.mode === 'none'} label="Original" onClick={() => setResize({ mode: 'none' })} />
        <Chip
          on={resize.mode === 'percent'}
          label="Percentage"
          onClick={() => setResize({ mode: 'percent' })}
        />
        <Chip
          on={resize.mode === 'exact'}
          label="Exact pixels"
          onClick={() => setResize({ mode: 'exact' })}
        />
        <Chip
          on={resize.mode === 'longest'}
          label="Longest side"
          onClick={() => setResize({ mode: 'longest' })}
        />
      </div>

      {resize.mode === 'percent' && (
        <div className="image-field-row">
          <label className="image-field image-field-inline">
            <span>Scale</span>
            <span className="image-suffix">
              <input
                type="number"
                min={1}
                max={1000}
                value={resize.percent}
                onChange={(e) => setResize({ percent: Number(e.target.value) })}
              />
              %
            </span>
          </label>
          <div className="image-chips">
            {PERCENT_PRESETS.map((percent) => (
              <Chip
                key={percent}
                on={resize.percent === percent}
                label={`${percent}%`}
                onClick={() => setResize({ percent })}
              />
            ))}
          </div>
        </div>
      )}

      {resize.mode === 'exact' && (
        <>
          <div className="image-field-row">
            <label className="image-field image-field-inline">
              <span>Width</span>
              <span className="image-suffix">
                <input
                  type="number"
                  min={1}
                  placeholder="auto"
                  value={resize.width ?? ''}
                  onChange={(e) => setResize({ width: numberOrNull(e.target.value) })}
                />
                px
              </span>
            </label>
            <label className="image-field image-field-inline">
              <span>Height</span>
              <span className="image-suffix">
                <input
                  type="number"
                  min={1}
                  placeholder="auto"
                  value={resize.height ?? ''}
                  onChange={(e) => setResize({ height: numberOrNull(e.target.value) })}
                />
                px
              </span>
            </label>
          </div>
          <label className="image-check">
            <input
              type="checkbox"
              checked={resize.lockAspect}
              onChange={(e) => setResize({ lockAspect: e.target.checked })}
            />
            <span>
              Lock aspect ratio
              {resize.lockAspect ? ' — fits inside the box you give' : ' — stretches to fit exactly'}
            </span>
          </label>
          <p className="image-note">Leave one side blank to have it follow the other.</p>
        </>
      )}

      {resize.mode === 'longest' && (
        <div className="image-field-row">
          <label className="image-field image-field-inline">
            <span>Longest side</span>
            <span className="image-suffix">
              <input
                type="number"
                min={1}
                value={resize.longest}
                onChange={(e) => setResize({ longest: Number(e.target.value) })}
              />
              px
            </span>
          </label>
          <div className="image-chips">
            {LONGEST_PRESETS.map((longest) => (
              <Chip
                key={longest}
                on={resize.longest === longest}
                label={`${longest}`}
                onClick={() => setResize({ longest })}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function TargetPanel({ pipeline }: { pipeline: Pipeline }) {
  const { options, setOption } = pipeline
  const lossless = options.format === 'png' || options.format === 'gif'

  return (
    <section className="image-panel" aria-labelledby="image-panel-target">
      <h3 id="image-panel-target">
        <span className="material-symbols-outlined" aria-hidden>
          data_usage
        </span>
        File size
      </h3>

      <label className="image-check">
        <input
          type="checkbox"
          checked={options.useTarget}
          onChange={(e) => setOption('useTarget', e.target.checked)}
        />
        <span>Aim for a maximum file size</span>
      </label>

      {options.useTarget && (
        <>
          <label className="image-field image-field-inline">
            <span>Target</span>
            <span className="image-suffix">
              <input
                type="number"
                min={1}
                max={100_000}
                value={options.targetKB}
                onChange={(e) => setOption('targetKB', Math.max(1, Number(e.target.value)))}
              />
              KB
            </span>
          </label>
          <p className="image-note">
            The quality dial is searched first, then the pixel size, keeping the largest result that
            still fits. Each file reports how many passes it took.
          </p>
          {lossless && (
            <p className="image-note image-note-warn">
              {options.format === 'png' ? 'PNG' : 'GIF'} has no quality setting, so the only way
              down is scaling. Pick WebP or JPEG if you need a small file at full size.
            </p>
          )}
        </>
      )}
    </section>
  )
}

function Chip({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" className={`image-chip${on ? ' on' : ''}`} aria-pressed={on} onClick={onClick}>
      {label}
    </button>
  )
}

function numberOrNull(value: string): number | null {
  if (value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null
}

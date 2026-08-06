import { useState } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { PipelineScreen } from './components/PipelineScreen'
import { SCREENS, screenById, type ScreenId } from './lib/screens'
import './image.css'

export default function ImageTool() {
  const [screen, setScreen] = useState<ScreenId | null>(null)
  const active = screen ? screenById(screen) : null

  return (
    <div className="image-app">
      <ToolHeader
        brand={
          <>
            <span className="image-mark" aria-hidden>
              IMG
            </span>
            Image converter
          </>
        }
        localLabel="local, no-upload"
        beforeSwitcher={
          active && (
            <nav className="image-tabs" aria-label="Image tools">
              {SCREENS.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  className={`image-tab${candidate.id === active.id ? ' on' : ''}`}
                  aria-current={candidate.id === active.id ? 'page' : undefined}
                  onClick={() => setScreen(candidate.id)}
                >
                  {candidate.name}
                </button>
              ))}
            </nav>
          )
        }
      >
        {active && (
          <button type="button" className="image-btn" onClick={() => setScreen(null)}>
            <span className="material-symbols-outlined" aria-hidden>
              apps
            </span>
            All image tools
          </button>
        )}
      </ToolHeader>

      <main id="main-content" className="image-main">
        {active ? (
          // Remounting per screen keeps each one on its own defaults.
          <PipelineScreen key={active.id} screen={active} />
        ) : (
          <Landing onPick={setScreen} />
        )}
      </main>
    </div>
  )
}

function Landing({ onPick }: { onPick: (id: ScreenId) => void }) {
  return (
    <div className="image-landing">
      <h1>Convert, resize and compress images</h1>
      <p className="image-lede">
        Batch up to 30 files at once. Decoding, resizing and encoding all happen in this tab — no
        upload, no server, no queue but your own.
      </p>

      <div className="image-landing-grid">
        {SCREENS.map((screen) => (
          <button key={screen.id} type="button" className="image-card" onClick={() => onPick(screen.id)}>
            <span
              className="image-card-icon"
              style={{ background: `${screen.color}22`, color: screen.color }}
            >
              <span className="material-symbols-outlined" aria-hidden>
                {screen.icon}
              </span>
            </span>
            <h2>{screen.name}</h2>
            <p className="image-card-tagline">{screen.tagline}</p>
            <p>{screen.description}</p>
          </button>
        ))}
      </div>

      <section className="image-facts">
        <h2>What this can and cannot do</h2>
        <dl>
          <div>
            <dt>Writes PNG, JPEG, WebP and GIF</dt>
            <dd>
              The first three come from the browser's own encoders. GIF has none, so this tool
              carries its own — median-cut palette, optional dithering, LZW, all client-side.
            </dd>
          </div>
          <div>
            <dt>Reads SVG, but does not write it</dt>
            <dd>
              An SVG is rasterised at whatever output size you pick. Going the other way is tracing,
              not converting, so it is not offered rather than faked.
            </dd>
          </div>
          <div>
            <dt>Animation is flattened</dt>
            <dd>
              An animated GIF, WebP or APNG converts as its first frame, and each file says so in
              its result row.
            </dd>
          </div>
          <div>
            <dt>Metadata is dropped</dt>
            <dd>
              Re-encoding through a canvas leaves EXIF, GPS and colour profiles behind. Orientation
              is applied first, so photos stay upright.
            </dd>
          </div>
        </dl>
      </section>
    </div>
  )
}

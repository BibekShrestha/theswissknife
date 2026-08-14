import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { tools } from './registry'
import { navigate } from './router'
import { paletteKeyLabel, rank, toCommands, type Command } from './palette'

const ALL = toCommands(tools)

interface PaletteProps {
  /** Current route, '' on the landing page — used to mark where you already are. */
  path: string
  onClose: () => void
}

export default function CommandPalette({ path, onClose }: PaletteProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => rank(ALL, query), [query])
  const index = Math.min(active, Math.max(results.length - 1, 0))
  const selected = results[index]
  const here = `/${path}`

  useEffect(() => setActive(0), [query])

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index, results])

  // Closing on Escape belongs on the window: a click on a row or the padding
  // takes focus off the input, and Escape has to keep working after that.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const run = (command: Command) => {
    onClose()
    if (command.to !== here) navigate(command.to)
  }

  const step = (by: number) => {
    if (results.length === 0) return
    setActive((i) => (Math.min(i, results.length - 1) + by + results.length) % results.length)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); step(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1) }
    else if (e.key === 'Enter' && selected) { e.preventDefault(); run(selected) }
  }

  return (
    <>
      <div className="palette-backdrop" onClick={onClose} />
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" data-shell-palette>
        <div className="palette-search">
          <span className="material-symbols-outlined" aria-hidden>search</span>
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search tools…"
            aria-label="Search tools"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={selected ? `palette-option-${index}` : undefined}
          />
          <kbd>{paletteKeyLabel()}</kbd>
        </div>

        <div className="palette-list" id="palette-list" role="listbox" aria-label="Tools" ref={listRef}>
          {results.map((command, i) => (
            <div
              key={command.to}
              id={`palette-option-${i}`}
              role="option"
              aria-selected={i === index}
              className="palette-row"
              onMouseMove={() => setActive(i)}
              onClick={() => run(command)}
            >
              <span className="palette-mark" aria-hidden>{command.mark}</span>
              <span className="palette-text">
                <strong>{command.name}</strong>
                <span>{command.hint}</span>
              </span>
              {command.to === here && <span className="palette-here">here</span>}
            </div>
          ))}
          {results.length === 0 && <p className="palette-empty">No tool matches “{query.trim()}”.</p>}
        </div>

        <div className="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </>
  )
}

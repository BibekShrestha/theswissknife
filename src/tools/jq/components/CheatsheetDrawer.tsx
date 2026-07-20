import { useEffect } from 'react'
import { cheatsheet } from '../cheatsheet'

interface Props {
  open: boolean
  onClose: () => void
  onInsert: (code: string) => void
}

export function CheatsheetDrawer({ open, onClose, onInsert }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <>
      {open && <div className="drawer-backdrop" onClick={onClose} />}
      <aside className={`drawer${open ? ' open' : ''}`} aria-hidden={!open}>
        <div className="drawer-head">
          <strong>jq reference</strong>
          <a href="https://jqlang.org/manual/" target="_blank" rel="noreferrer">
            full manual ↗
          </a>
          <button className="icon-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
        <div className="drawer-body">
          <p className="drawer-tip">Click any snippet to insert it into the filter.</p>
          {cheatsheet.map((section, i) => (
            <details key={section.title} open={i < 2}>
              <summary>{section.title}</summary>
              <div className="cs-items">
                {section.items.map((item) => (
                  <div className="cs-item" key={item.code}>
                    <button className="cs-code" onClick={() => onInsert(item.code)} title="Insert into filter">
                      {item.code}
                    </button>
                    <span className="cs-desc">{item.desc}</span>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      </aside>
    </>
  )
}

import { useRef, type KeyboardEvent } from 'react'

interface Props<T extends string> {
  tabs: [T, string][]
  active: T
  onSelect: (id: T) => void
  /** id of the tabpanel the tabs control. */
  panelId: string
}

export const tabId = (id: string) => `regex-tab-${id}`

/**
 * WAI-ARIA tabs: one tab stop (the selected tab), arrow keys, Home and End
 * move between tabs and select them, and every tab names the panel it controls.
 */
export function ResultTabs<T extends string>({ tabs, active, onSelect, panelId }: Props<T>) {
  const listRef = useRef<HTMLDivElement>(null)

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex(([id]) => id === active)
    let next = -1
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    if (next < 0) return
    event.preventDefault()
    const [id] = tabs[next]
    onSelect(id)
    listRef.current?.querySelector<HTMLElement>(`#${tabId(id)}`)?.focus()
  }

  return (
    <div ref={listRef} className="regex-tabs" role="tablist" aria-label="Result views" onKeyDown={onKeyDown}>
      {tabs.map(([id, label]) => (
        <button
          key={id}
          id={tabId(id)}
          role="tab"
          aria-selected={active === id}
          aria-controls={panelId}
          tabIndex={active === id ? 0 : -1}
          className={`regex-tab${active === id ? ' on' : ''}`}
          onClick={() => onSelect(id)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

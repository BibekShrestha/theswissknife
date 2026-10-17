import { useId, useMemo, useRef, useState } from 'react'
import { RENAMED, searchZones, zoneCity, zoneList } from './catalog'
import { formatOffset, offsetMinutes } from './zone'

const ALL = zoneList()
const rawLocal = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const localZone = RENAMED[rawLocal] ?? rawLocal
if (!ALL.includes(localZone)) ALL.push(localZone)

export { ALL as ALL_ZONES, localZone }

interface ZonePickerProps {
  /** Current zone; omit for an "add a zone" box. */
  value?: string
  onPick: (zone: string) => void
  /** Instant used for the offsets shown next to each match. */
  at: number
  label: string
  placeholder?: string
  exclude?: string[]
}

const NONE: string[] = []

export function ZonePicker({ value, onPick, at, label, placeholder, exclude = NONE }: ZonePickerProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const id = useId()
  const blurTimer = useRef<number>(undefined)

  const result = useMemo(() => searchZones(query, ALL.filter((z) => !exclude.includes(z)), 12), [query, exclude])
  const options = result.zones

  const pick = (zone: string) => {
    onPick(zone)
    setQuery('')
    setOpen(false)
    setActive(0)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, options.length - 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (event.key === 'Enter') {
      if (open && options[active]) { event.preventDefault(); pick(options[active]) }
    } else if (event.key === 'Escape') { setOpen(false); setQuery('') }
  }

  const abbr = result.abbreviation
  return (
    <div className="dates-picker">
      <input
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${id}-${active}` : undefined}
        className="dates-picker-input"
        value={open ? query : value ?? query}
        placeholder={open && value ? value : placeholder}
        spellCheck={false}
        autoComplete="off"
        onFocus={() => { window.clearTimeout(blurTimer.current); setOpen(true); setQuery('') }}
        onBlur={() => { blurTimer.current = window.setTimeout(() => { setOpen(false); setQuery('') }, 150) }}
        onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true) }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <div className="dates-picker-pop">
          {abbr && (
            <p className={`dates-picker-abbr${abbr.ambiguous ? ' dates-picker-ambiguous' : ''}`}>
              {abbr.ambiguous
                ? <><strong>{abbr.abbr} is ambiguous.</strong> It can mean {abbr.entry.meanings.map((m) => m.label).join('; ')}. Pick the zone you mean.</>
                : <><strong>{abbr.abbr}</strong> — {abbr.entry.meanings[0].label}.</>}
              {abbr.entry.note && <> {abbr.entry.note}</>}
            </p>
          )}
          <ul id={`${id}-list`} role="listbox" aria-label={`${label} matches`}>
            {options.length === 0 && <li className="dates-picker-empty">No zone matches “{query}”</li>}
            {options.map((zone, i) => (
              <li
                key={zone}
                id={`${id}-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'on' : ''}
                onMouseDown={(event) => { event.preventDefault(); pick(zone) }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="dates-picker-city">{zoneCity(zone)}</span>
                <span className="dates-picker-id mono">{zone}</span>
                <span className="dates-picker-off mono">{formatOffset(offsetMinutes(at, zone))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

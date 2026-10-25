import { useEffect, useId, useState } from 'react'
import { adToDay, bsToDay, dayToAd, dayToBs, FIRST_DAY, inRange, isoDate, LAST_DAY, today } from './calendar'
import { parseBs } from './parse'

const AD_MIN = isoDate(dayToAd(FIRST_DAY))
const AD_MAX = isoDate(dayToAd(LAST_DAY))

interface Props {
  label: string
  /** A day number inside the table. */
  value: number
  onChange: (day: number) => void
}

/** One date, typed as BS or picked as AD; either side updates the other. */
export function DateField({ label, value, onChange }: Props) {
  const id = useId()
  const [draft, setDraft] = useState(() => isoDate(dayToBs(value)!))
  const [adError, setAdError] = useState('')
  const parsed = parseBs(draft)

  // A change from outside (the other field, the calendar, Today) rewrites the BS text.
  useEffect(() => {
    setDraft((text) => {
      const p = parseBs(text)
      return p.ok && bsToDay(p.date) === value ? text : isoDate(dayToBs(value)!)
    })
    setAdError('')
  }, [value])

  const onBs = (text: string) => {
    setDraft(text)
    const p = parseBs(text)
    // parseBs only returns dates the table holds.
    if (p.ok) onChange(bsToDay(p.date)!)
  }

  const onAd = (text: string) => {
    const m = /^(\d{4,})-(\d{2})-(\d{2})$/.exec(text)
    if (!m) return
    const n = adToDay({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) })
    if (!inRange(n)) {
      setAdError(`Only ${AD_MIN} to ${AD_MAX} AD (2000–2083 BS) is covered.`)
      return
    }
    setAdError('')
    onChange(n)
  }

  const error = parsed.ok ? adError : parsed.error
  return (
    <fieldset className="ndate-field">
      <legend className="ndate-label">{label}</legend>
      <div className="ndate-field-row">
        <label className="ndate-input">
          <span>BS</span>
          <input
            value={draft}
            onChange={(event) => onBs(event.target.value)}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!parsed.ok}
            aria-describedby={error ? `${id}-error` : undefined}
            placeholder="2082-07-08"
          />
        </label>
        <label className="ndate-input">
          <span>AD</span>
          <input type="date" min={AD_MIN} max={AD_MAX} value={isoDate(dayToAd(value))} onChange={(event) => onAd(event.target.value)} aria-invalid={Boolean(adError)} />
        </label>
        <button type="button" onClick={() => { const n = today(); if (inRange(n)) onChange(n); else setAdError('Today is outside 2000–2083 BS.') }}>
          Today
        </button>
      </div>
      {error && <p className="ndate-error" id={`${id}-error`} role="alert">{error}</p>}
    </fieldset>
  )
}


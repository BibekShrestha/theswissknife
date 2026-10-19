import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { BladeMark } from './BladeMark'
import type { Category } from './Landing'
import { tools } from './registry'
import { Link } from './router'

/** The landing hero's artwork: one blade per category, fanned from a pivot. Lazy (see Landing.tsx). */

const lengths = [368, 334, 386, 352, 322, 376, 344]
const SPREAD = 55

/**
 * `categories` comes in as a prop: a runtime import from Landing would be a
 * cycle, which the bundler resolves by splitting shared modules out of the
 * entry into extra eager chunks (+0.6 KiB gz).
 */
export default function Knife({ categories }: { categories: Category[] }): ReactNode {
  const [open, setOpen] = useState(false)

  // Fan out once the folded state has painted, so the opening animates.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const step = (SPREAD * 2) / (categories.length - 1)

  return (
    <>
      <div className="landing-knife">
        <svg viewBox="0 0 560 500" className="knife-guide" fill="none" aria-hidden>
          <path d="M 15 285 A 320 320 0 0 1 545 285" />
        </svg>

        {categories.map((category, index) => {
          const tool = tools.find((t) => t.category === category.id)!
          const angle = -90 - SPREAD + index * step
          const style = {
            '--blade-angle': `${angle}deg`,
            '--blade-width': `${lengths[index]}px`,
            '--blade-delay': `${index * 75}ms`,
            '--blade-z': index + 1,
          } as CSSProperties
          return (
            <Link
              key={category.id}
              to={`/${tool.slug}`}
              // Blades left of upright would read upside down; .flip turns their label.
              className={`knife-blade${open ? ' open' : ''}${angle < -90 ? ' flip' : ''}`}
              style={style}
              aria-label={`${category.name}: open ${tool.name}`}
            >
              <span className="knife-blade-face">
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{category.short}</strong>
              </span>
            </Link>
          )
        })}

        <div className="knife-body">
          <BladeMark className="knife-body-mark" />
        </div>
        {/* The ripple is CSS: each aria-expanded value names its own keyframes. */}
        <button type="button" className="knife-pivot" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label="Tool blades" />
      </div>
      <p>{open ? 'pick a blade' : 'click the pivot to open'}</p>
    </>
  )
}

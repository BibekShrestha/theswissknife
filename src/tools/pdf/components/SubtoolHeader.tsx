import type { CSSProperties } from 'react'

interface SubtoolHeaderProps {
  icon: string
  /** The tool's hue; the tile mixes it with theme surfaces so it suits both themes. */
  color: string
  title: string
  description: string
}

export function SubtoolHeader({ icon, color, title, description }: SubtoolHeaderProps) {
  return (
    <div className="pdf-subtool-header">
      <div className="pdf-subtool-icon" style={{ '--pdf-tile': color } as CSSProperties}>
        <span className="material-symbols-outlined" aria-hidden="true">{icon}</span>
      </div>
      <div className="pdf-subtool-info">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  )
}

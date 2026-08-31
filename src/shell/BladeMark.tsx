interface BladeMarkProps {
  className?: string
}

/** Compact Swiss-knife mark shared by the shell header and landing artwork. */
export function BladeMark({ className = '' }: BladeMarkProps) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden>
      <g fill="currentColor">
        <path d="M13.6 20.5 16 5.2l2.4 15.3Z" transform="rotate(-42 16 20.5)" />
        <path d="M13.2 20.5 16 3.2l2.8 17.3Z" />
        <path d="M13.6 20.5 16 5.2l2.4 15.3Z" transform="rotate(42 16 20.5)" />
      </g>
      <circle cx="16" cy="20.5" r="3.1" fill="var(--accent)" />
    </svg>
  )
}

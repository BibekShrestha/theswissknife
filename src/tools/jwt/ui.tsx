import type { ReactNode } from 'react'

/** Segment tones — h/p/s match the token's colored parts. */
export type Tone = 'h' | 'p' | 's' | 'none'

export function Card({
  tone = 'none',
  title,
  badge,
  actions,
  fill,
  children,
}: {
  tone?: Tone
  title: ReactNode
  badge?: ReactNode
  actions?: ReactNode
  fill?: boolean
  children: ReactNode
}) {
  return (
    <section className={`jwt-card tone-${tone}${fill ? ' fill' : ''}`}>
      <div className="jwt-card-head">
        <span className="jwt-card-dot" aria-hidden />
        <span className="jwt-card-title">{title}</span>
        {badge}
        {actions && <div className="jwt-card-actions">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

/** Minimal JSON colorizer (duplicated per-tool by design). */
export function colorJson(text: string): ReactNode[] {
  const re = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b/g
  const nodes: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const tok = m[0]
    const cls =
      tok[0] === '"'
        ? /^\s*:/.test(text.slice(m.index + tok.length))
          ? 'tok-key'
          : 'tok-str'
        : tok === 'true' || tok === 'false' || tok === 'null'
          ? 'tok-lit'
          : 'tok-num'
    nodes.push(
      <span key={k++} className={cls}>
        {tok}
      </span>,
    )
    last = m.index + tok.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

/** Editable JSON area with syntax colors: transparent textarea over a <pre>. */
export function JsonEditor({
  value,
  onChange,
  minRows = 4,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  minRows?: number
  ariaLabel: string
}) {
  return (
    <div className="jwt-json-wrap" style={{ minHeight: `${minRows * 1.5 + 1.4}em` }}>
      <pre className="jwt-json-color" aria-hidden>
        {colorJson(value)}
        {'\n'}
      </pre>
      <textarea
        className="jwt-json-edit"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        aria-label={ariaLabel}
      />
    </div>
  )
}

/** A JWT string with its three segments colored (best-effort mid-edit). */
export function ColoredToken({ token }: { token: string }) {
  const parts = token.split('.')
  const cls = ['jwt-seg-h', 'jwt-seg-p', 'jwt-seg-s']
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && <span className="jwt-tok-dot">.</span>}
          <span className={cls[Math.min(i, 2)]}>{part}</span>
        </span>
      ))}
      {'\n'}
    </>
  )
}

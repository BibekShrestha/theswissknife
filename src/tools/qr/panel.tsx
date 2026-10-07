import type { ReactNode } from 'react'

export function Panel({ step, title, hint, aside, children, collapsible, defaultOpen = true }: { step: string; title: string; hint?: string; aside?: ReactNode; children: ReactNode; collapsible?: boolean; defaultOpen?: boolean }) {
  const head = <><span className="qr-step">{step}</span><strong>{title}</strong>{hint && <span className="qr-hint">{hint}</span>}{aside && <div className="qr-aside">{aside}</div>}</>
  if (collapsible) {
    return (
      <details className="qr-panel" open={defaultOpen || undefined}>
        <summary className="qr-panel-head">{head}<span className="material-symbols-outlined qr-chevron" aria-hidden>expand_more</span></summary>
        <div className="qr-panel-body">{children}</div>
      </details>
    )
  }
  return (
    <section className="qr-panel">
      <header className="qr-panel-head">{head}</header>
      <div className="qr-panel-body">{children}</div>
    </section>
  )
}

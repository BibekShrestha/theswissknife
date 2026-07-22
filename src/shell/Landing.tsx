import { useState } from 'react'
import { tools } from './registry'
import { Link } from './router'
import { useTheme } from './theme'

const categories: { id: string; name: string; description: string }[] = [
  { id: 'data', name: 'Data', description: 'Query and transform structured data' },
  { id: 'security', name: 'Security', description: 'Inspect and generate tokens & keys' },
  { id: 'text', name: 'Text', description: 'Pattern matching, encoding and decoding' },
  { id: 'time', name: 'Time', description: 'Convert and compare timestamps across zones' },
  { id: 'pdf', name: 'PDF', description: 'Merge, split, convert and protect documents' },
]

export function Landing() {
  const [theme, toggleTheme] = useTheme()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="landing">
      <header className="landing-header">
        <Link to="/" className="landing-brand" title="The Swiss Knife home">
          <span className="brand-cross" aria-hidden>
            <span className="material-symbols-outlined">home</span>
          </span>
          <span>The Swiss Knife</span>
        </Link>

        <div className="spacer" />

        <button className="landing-about-btn" onClick={() => document.getElementById('why')?.scrollIntoView({ behavior: 'smooth' })} aria-label="About The Swiss Knife">
          <span className="material-symbols-outlined" aria-hidden>info</span>
        </button>

        <span className="landing-local">local by design</span>

        <a href="https://github.com/BibekShrestha/theswissknife" target="_blank" rel="noreferrer" className="landing-gh-link" aria-label="GitHub">
          <span className="material-symbols-outlined" aria-hidden>code</span>
          <span className="gh-text">GitHub</span>
        </a>

        <button className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
          <span className="material-symbols-outlined" aria-hidden>{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
        </button>

        <button className="landing-menu-btn" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu" aria-expanded={menuOpen}>
          <span className="material-symbols-outlined" aria-hidden>{menuOpen ? 'close' : 'menu'}</span>
        </button>
      </header>

      {menuOpen && (
        <div className="landing-mobile-nav">
          <button onClick={() => { setMenuOpen(false); document.getElementById('why')?.scrollIntoView({ behavior: 'smooth' }) }}><span className="material-symbols-outlined" aria-hidden>info</span> About</button>
          <a href="https://github.com/BibekShrestha/theswissknife" target="_blank" rel="noreferrer">GitHub</a>
        </div>
      )}

      <main id="main-content" className="landing-main">
        <section className="landing-hero">
          <div className="hero-bg" />
          <p className="landing-kicker">Private developer utilities</p>
          <h1>Sharp little tools<br />for daily work.</h1>
          <p className="landing-sub">
            Inspect, transform and test without handing your data to a server. Everything runs in
            this tab — no accounts, uploads or analytics.
          </p>
          <div className="landing-chips">
            <span className="landing-chip">
              <span className="material-symbols-outlined" aria-hidden>lock</span>
              100% client-side
            </span>
            <span className="landing-chip">
              <span className="material-symbols-outlined" aria-hidden>shield</span>
              No uploads
            </span>
            <span className="landing-chip">
              <span className="material-symbols-outlined" aria-hidden>code</span>
              Open source
            </span>
          </div>
          <a href="#tools" className="landing-cta">
            Explore tools
            <span className="material-symbols-outlined" aria-hidden>arrow_downward</span>
          </a>
        </section>

        <section className="landing-tools" id="tools" aria-label="Tools">
          {categories.map((cat) => {
            const catTools = tools.filter((t) => t.category === cat.id)
            if (catTools.length === 0) return null
            return (
              <div className="landing-tools-category" key={cat.id}>
                <h3>{cat.name}</h3>
                <p>{cat.description}</p>
                <div className="landing-tools-grid">
                  {catTools.map((t) => (
                    <Link key={t.slug} to={`/${t.slug}`} className="landing-tool-card">
                      <span className="landing-tool-card-mark" aria-hidden>{t.mark}</span>
                      <h4>{t.name}</h4>
                      <p>{t.tagline}</p>
                    </Link>
                  ))}
                </div>
              </div>
            )
          })}
        </section>

        <section className="landing-why" id="why">
          <div className="why-head">
            <h2>Why The Swiss Knife?</h2>
            <p>Fast file work, clear security boundaries, and zero friction</p>
          </div>
          <div className="why-grid">
            <div className="why-card">
              <div className="why-icon" style={{ '--icon-bg': 'var(--ok)' } as React.CSSProperties}>
                <span className="material-symbols-outlined" aria-hidden>lock</span>
              </div>
              <h3>Privacy First</h3>
              <p>All tools run directly in your browser. Nothing you paste is ever sent to a server — no accounts, no uploads, no analytics.</p>
            </div>
            <div className="why-card">
              <div className="why-icon" style={{ '--icon-bg': '#d93025' } as React.CSSProperties}>
                <span className="material-symbols-outlined" aria-hidden>bolt</span>
              </div>
              <h3>Fast & Lightweight</h3>
              <p>Lazy-loaded tool chunks keep the initial bundle small. The main bundle stays ~62 KB gzipped regardless of how many tools you add.</p>
            </div>
            <div className="why-card">
              <div className="why-icon" style={{ '--icon-bg': '#1e7351' } as React.CSSProperties}>
                <span className="material-symbols-outlined" aria-hidden>code</span>
              </div>
              <h3>Open Source</h3>
              <p>MIT-licensed and built in the open. Contributions, bug reports, and feature requests are welcome on GitHub.</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-foot">
        <span>Nothing pasted here leaves your machine.</span>
        <span>Open source · MIT · <code>theswissknife.com</code></span>
      </footer>
    </div>
  )
}

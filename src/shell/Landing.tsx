import { useState } from 'react'
import { tools } from './registry'
import { Link } from './router'
import { useTheme } from './theme'

const categories = ['all', 'data', 'security', 'text', 'time', 'pdf'] as const

export function Landing() {
  const [theme, toggleTheme] = useTheme()
  const [activeCat, setActiveCat] = useState<string>('all')
  const [menuOpen, setMenuOpen] = useState(false)
  const filtered = activeCat === 'all' ? tools : tools.filter((t) => t.category === activeCat)

  return (
    <div className="landing">
      <header className="landing-header">
        <Link to="/" className="landing-brand" title="The Swiss Knife home">
          <span className="brand-cross" aria-hidden>
            <span className="material-symbols-outlined">home</span>
          </span>
          <span>The Swiss Knife</span>
        </Link>

        <nav className="landing-nav" role="navigation" aria-label="Tool categories">
          {categories.filter(c => c !== 'all').map((cat) => (
            <button key={cat} onClick={() => { setActiveCat(cat); setMenuOpen(false) }}>
              {cat}
            </button>
          ))}
          <button onClick={() => document.getElementById('why')?.scrollIntoView({ behavior: 'smooth' })}>About</button>
        </nav>

        <div className="spacer" />

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
          {categories.filter(c => c !== 'all').map((cat) => (
            <button key={cat} onClick={() => { setActiveCat(cat); setMenuOpen(false) }}>
              {cat}
            </button>
          ))}
          <button onClick={() => { setMenuOpen(false); document.getElementById('why')?.scrollIntoView({ behavior: 'smooth' }) }}>About</button>
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
          <a href="#tool-index" className="landing-cta">
            Browse tools
            <span className="material-symbols-outlined" aria-hidden>arrow_downward</span>
          </a>
        </section>

        <section className="tool-index" id="tool-index" aria-labelledby="tools-heading">
          <div className="tool-index-head">
            <div>
              <h2 id="tools-heading">Tool index</h2>
              <p>Six instruments for your daily workflow</p>
            </div>
            <span>{String(tools.length).padStart(2, '0')} instruments</span>
          </div>
          <div className="category-filter" role="group" aria-label="Filter by category">
            {categories.map((cat) => (
              <button
                key={cat}
                className={`category-pill${activeCat === cat ? ' on' : ''}`}
                onClick={() => setActiveCat(cat)}
                aria-pressed={activeCat === cat}
              >
                {cat}
              </button>
            ))}
          </div>
          <div className="tool-grid">
            {filtered.map((t) => (
              <Link key={t.slug} to={`/${t.slug}`} className="tool-card">
                <span className="tool-card-category">{t.category}</span>
                <span className="tool-mark" aria-hidden>{t.mark}</span>
                <span className="tool-name">{t.name}</span>
                <span className="tool-tagline">{t.tagline}</span>
                <span className="tool-card-foot">
                  <span className="tool-path">/{t.slug}</span>
                  <span className="tool-arrow" aria-hidden>
                    <span className="material-symbols-outlined">arrow_outward</span>
                  </span>
                </span>
              </Link>
            ))}
          </div>
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

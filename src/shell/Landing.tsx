import { useState } from 'react'
import { tools } from './registry'
import { Link } from './router'
import { useTheme } from './theme'

const categories = ['all', 'data', 'security', 'text', 'time'] as const

export function Landing() {
  const [theme, toggleTheme] = useTheme()
  const [activeCat, setActiveCat] = useState<string>('all')
  const filtered = activeCat === 'all' ? tools : tools.filter((t) => t.category === activeCat)

  return (
    <div className="landing">
      <header className="landing-top">
        <Link to="/" className="landing-brand" title="The Swiss Knife home">
          <span className="brand-cross" aria-hidden><span className="material-symbols-outlined">home</span></span>
          <span>The Swiss Knife</span>
        </Link>
        <div className="spacer" />
        <span className="landing-local">local by design</span>
        <a href="https://github.com/BibekShrestha/theswissknife" target="_blank" rel="noreferrer">
          GitHub <span className="material-symbols-outlined" aria-hidden>open_in_new</span>
        </a>
        <button className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
          <span className="material-symbols-outlined" aria-hidden>{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
        </button>
      </header>

      <main id="main-content" className="landing-main">
        <section className="landing-hero">
          <p className="landing-kicker">Private developer utilities / 05</p>
          <h1>Sharp little tools<br />for daily work.</h1>
          <p className="landing-sub">
            Inspect, transform and test without handing your data to a server. Everything runs in
            this tab — no accounts, uploads or analytics.
          </p>
        </section>

        <section className="tool-index" aria-labelledby="tools-heading">
          <div className="tool-index-head">
            <h2 id="tools-heading">Tool index</h2>
            <span>{String(tools.length).padStart(2, '0')} instruments</span>
          </div>
          <div className="category-filter" role="group" aria-label="Filter by category">
            {categories.map((cat) => (
              <button key={cat} className={`category-pill${activeCat === cat ? ' on' : ''}`} onClick={() => setActiveCat(cat)} aria-pressed={activeCat === cat}>
                {cat}
              </button>
            ))}
          </div>
          <div className="tool-grid">
          {filtered.map((t, index) => (
            <Link key={t.slug} to={`/${t.slug}`} className="tool-card">
              <span className="tool-card-top">
                <span className="tool-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="tool-category">{t.category}</span>
                <span className="tool-arrow" aria-hidden><span className="material-symbols-outlined">arrow_outward</span></span>
              </span>
              <span className="tool-mark" aria-hidden>{t.mark}</span>
              <span className="tool-name">{t.name}</span>
              <span className="tool-tagline">{t.tagline}</span>
              <span className="tool-path">/{t.slug}</span>
            </Link>
          ))}
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

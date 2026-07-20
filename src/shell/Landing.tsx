import { tools } from './registry'
import { Link } from './router'
import { useTheme } from './theme'

export function Landing() {
  const [theme, toggleTheme] = useTheme()

  return (
    <div className="landing">
      <header className="landing-top">
        <span className="landing-brand">
          <span className="brand-cross">✚</span> The Swiss Knife
        </span>
        <div className="spacer" />
        <a href="https://github.com/BibekShrestha/theswissknife" target="_blank" rel="noreferrer">
          GitHub ↗
        </a>
        <button className="icon-btn" onClick={toggleTheme} title="Toggle theme">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </header>

      <main className="landing-main">
        <h1>Sharp little tools for daily work.</h1>
        <p className="landing-sub">
          Dedicated, no-nonsense developer tools. Everything runs in your browser — nothing you
          paste ever leaves your machine.
        </p>

        <div className="tool-grid">
          {tools.map((t) => (
            <Link key={t.slug} to={`/${t.slug}`} className="tool-card">
              <span className="tool-icon" aria-hidden>
                {t.icon}
              </span>
              <span className="tool-name">{t.name}</span>
              <span className="tool-tagline">{t.tagline}</span>
              <span className="tool-path">/{t.slug}</span>
            </Link>
          ))}
        </div>
      </main>

      <footer className="landing-foot">
        100% client-side · open source (MIT) · <code>theswissknife.com</code>
      </footer>
    </div>
  )
}

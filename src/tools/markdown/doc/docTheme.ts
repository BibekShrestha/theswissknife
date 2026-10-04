/**
 * The document stylesheet — the single source of truth for what the preview
 * looks like, what the exported .html looks like, and what comes out of the
 * print dialog. One builder, three consumers, so they cannot drift apart.
 *
 * Every theme is a selector → declarations map rather than a CSS blob, which
 * is what lets docTheme.test.ts assert all three cover the same selectors: a
 * theme that forgot `pre` would otherwise ship code blocks with no styling at
 * all, and only in that theme.
 *
 * Fonts are system stacks on purpose. A webfont would either break the
 * "one self-contained file" promise of the HTML export or bloat it by
 * hundreds of KB; KaTeX (only when the document has math) is the one
 * exception, and it announces itself in the UI.
 */

export type ThemeId = 'github' | 'clean' | 'academic'
export type PaperId = 'a4' | 'letter' | 'legal' | 'a5'
export type MarginId = 'narrow' | 'normal' | 'wide'

export interface DocSettings {
  theme: ThemeId
  paper: PaperId
  landscape: boolean
  margin: MarginId
  /** Body text size in px; headings and code scale from it. */
  fontSize: number
  lineHeight: number
  toc: boolean
  /** Deepest heading level the TOC lists (2 = h2 only). */
  tocDepth: 2 | 3 | 4
  /** Print the target after each external link — a paper page has no hover. */
  linkUrls: boolean
  highlight: boolean
  /** Screen-only banding that approximates where pages will break. */
  pageGuide: boolean
}

export const DEFAULT_SETTINGS: DocSettings = {
  theme: 'github',
  paper: 'a4',
  landscape: false,
  margin: 'normal',
  fontSize: 15,
  lineHeight: 1.65,
  toc: false,
  tocDepth: 3,
  linkUrls: false,
  highlight: true,
  pageGuide: true,
}

export const PAPERS: { id: PaperId; name: string; css: string; width: number; height: number }[] = [
  { id: 'a4', name: 'A4', css: 'A4', width: 210, height: 297 },
  { id: 'letter', name: 'Letter', css: 'letter', width: 215.9, height: 279.4 },
  { id: 'legal', name: 'Legal', css: 'legal', width: 215.9, height: 355.6 },
  { id: 'a5', name: 'A5', css: 'A5', width: 148, height: 210 },
]

export const MARGINS: { id: MarginId; name: string; mm: number }[] = [
  { id: 'narrow', name: 'Narrow', mm: 12 },
  { id: 'normal', name: 'Normal', mm: 20 },
  { id: 'wide', name: 'Wide', mm: 30 },
]

export const THEMES: { id: ThemeId; name: string; note: string }[] = [
  { id: 'github', name: 'GitHub', note: 'What a README looks like on GitHub' },
  { id: 'clean', name: 'Clean', note: 'Airy sans-serif, minimal rules' },
  { id: 'academic', name: 'Academic', note: 'Serif and justified, for print' },
]

/**
 * The contract every theme fills. Adding a selector here without adding it to
 * all three themes fails docTheme.test.ts, which is the point.
 */
export const THEME_SELECTORS = [
  ':root',
  'body',
  'h1',
  'h2',
  'h3',
  'h4, h5, h6',
  'a',
  'code',
  'pre',
  'blockquote',
  'table',
  'th',
  'td',
  'hr',
  '.md-toc',
  '.md-footnotes',
] as const

type ThemeRules = Record<(typeof THEME_SELECTORS)[number], string>

const SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, "Helvetica Neue", Arial, sans-serif'
const SERIF = 'Charter, "Iowan Old Style", Georgia, Cambria, "Times New Roman", Times, serif'
const MONO =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'

const THEME_RULES: Record<ThemeId, ThemeRules> = {
  github: {
    ':root': `--ink:#1f2328;--muted:#59636e;--link:#0969da;--rule:#d1d9e0;--soft:#f6f8fa;--quote:#59636e`,
    body: `font-family:${SANS};color:var(--ink)`,
    h1: `font-size:2em;font-weight:600;padding-bottom:.3em;border-bottom:1px solid var(--rule)`,
    h2: `font-size:1.5em;font-weight:600;padding-bottom:.3em;border-bottom:1px solid var(--rule)`,
    h3: `font-size:1.25em;font-weight:600`,
    'h4, h5, h6': `font-size:1em;font-weight:600`,
    a: `color:var(--link);text-decoration:none`,
    code: `font-family:${MONO};font-size:.87em;background:var(--soft);padding:.2em .4em;border-radius:4px`,
    pre: `font-family:${MONO};font-size:.85em;background:var(--soft);padding:1em;border-radius:6px;line-height:1.45`,
    blockquote: `color:var(--quote);border-left:.25em solid var(--rule);padding:0 1em`,
    table: `border:1px solid var(--rule)`,
    th: `background:var(--soft);border:1px solid var(--rule);padding:.5em .75em;font-weight:600;text-align:left`,
    td: `border:1px solid var(--rule);padding:.5em .75em`,
    hr: `border:none;border-top:2px solid var(--rule)`,
    '.md-toc': `background:var(--soft);border:1px solid var(--rule);border-radius:6px;padding:1em 1.25em`,
    '.md-footnotes': `border-top:1px solid var(--rule);color:var(--muted)`,
  },
  clean: {
    ':root': `--ink:#22252a;--muted:#6b7280;--link:#22252a;--rule:#e5e7eb;--soft:#f7f7f8;--quote:#4b5563`,
    body: `font-family:${SANS};color:var(--ink);letter-spacing:-0.003em`,
    h1: `font-size:2.1em;font-weight:650;letter-spacing:-0.02em`,
    h2: `font-size:1.55em;font-weight:620;letter-spacing:-0.015em`,
    h3: `font-size:1.22em;font-weight:600`,
    'h4, h5, h6': `font-size:1em;font-weight:600;color:var(--muted)`,
    a: `color:var(--link);text-decoration:underline;text-underline-offset:2px`,
    code: `font-family:${MONO};font-size:.87em;background:var(--soft);padding:.15em .35em;border-radius:3px`,
    pre: `font-family:${MONO};font-size:.85em;background:var(--soft);padding:1em 1.1em;border-radius:8px;line-height:1.5`,
    blockquote: `color:var(--quote);border-left:2px solid var(--rule);padding:0 1.1em;font-style:italic`,
    table: `border-bottom:1px solid var(--rule)`,
    th: `border-bottom:1.5px solid var(--ink);padding:.55em .7em;font-weight:600;text-align:left`,
    td: `border-bottom:1px solid var(--rule);padding:.55em .7em`,
    hr: `border:none;border-top:1px solid var(--rule);margin:2.5em auto;width:40%`,
    '.md-toc': `border-left:2px solid var(--rule);padding:.25em 0 .25em 1.1em`,
    '.md-footnotes': `border-top:1px solid var(--rule);color:var(--muted)`,
  },
  academic: {
    ':root': `--ink:#161616;--muted:#555;--link:#1a3e8c;--rule:#c9c4bb;--soft:#f4f2ed;--quote:#3d3d3d`,
    body: `font-family:${SERIF};color:var(--ink);text-align:justify;hyphens:auto`,
    h1: `font-size:1.9em;font-weight:600;text-align:center;margin-bottom:1.2em`,
    h2: `font-size:1.4em;font-weight:600`,
    h3: `font-size:1.15em;font-weight:600;font-style:italic`,
    'h4, h5, h6': `font-size:1em;font-weight:600;font-style:italic`,
    a: `color:var(--link);text-decoration:none;border-bottom:1px solid rgba(26,62,140,.35)`,
    code: `font-family:${MONO};font-size:.85em;background:var(--soft);padding:.1em .3em`,
    pre: `font-family:${MONO};font-size:.8em;background:var(--soft);padding:.9em 1em;border:1px solid var(--rule);line-height:1.45;text-align:left`,
    blockquote: `color:var(--quote);margin-left:1.5em;margin-right:1.5em;font-size:.96em`,
    table: `border-top:1.5px solid var(--ink);border-bottom:1.5px solid var(--ink);font-size:.95em`,
    th: `border-bottom:1px solid var(--ink);padding:.45em .7em;font-weight:600;text-align:left`,
    td: `padding:.45em .7em;text-align:left`,
    hr: `border:none;border-top:1px solid var(--rule)`,
    '.md-toc': `border:1px solid var(--rule);padding:1em 1.25em;font-size:.95em;text-align:left`,
    '.md-footnotes': `border-top:1px solid var(--rule);color:var(--muted);font-size:.9em`,
  },
}

/** Token colours are shared by all themes: dark on light, so they survive print. */
const HIGHLIGHT_CSS = `
.hl-com{color:#6a737d;font-style:italic}
.hl-str{color:#0a5c36}
.hl-num{color:#8a4b16}
.hl-key{color:#a1237a}
.hl-lit{color:#0550ae}
.hl-meta{color:#7d4e00}
.hl-add{color:#0a5c36;background:rgba(10,92,54,.08);display:inline-block;width:100%}
.hl-del{color:#a11c18;background:rgba(161,28,24,.08);display:inline-block;width:100%}
`

/** Structure, spacing and print behaviour — identical in every theme. */
const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#fff;font-size:var(--doc-font-size);line-height:var(--doc-line-height);
  text-underline-offset:2px;overflow-wrap:break-word}
#doc{max-width:var(--doc-width);margin:0 auto;padding:var(--doc-pad-y) var(--doc-pad-x)}
#doc>:first-child{margin-top:0}
h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.6em 0 .6em;break-after:avoid;page-break-after:avoid}
h1{margin-top:0}
p,ul,ol,dl,pre,blockquote,table,figure{margin:0 0 1.05em}
p,li{orphans:3;widows:3}
ul,ol{padding-left:1.6em}
li+li{margin-top:.25em}
li>ul,li>ol{margin:.25em 0}
li.task-list-item{list-style:none;margin-left:-1.6em;padding-left:1.6em}
li.task-list-item input{margin:0 .45em 0 0;vertical-align:middle}
pre{overflow-x:auto;white-space:pre-wrap;overflow-wrap:anywhere;break-inside:avoid}
pre code{background:none;padding:0;font-size:inherit;border-radius:0}
blockquote>:last-child{margin-bottom:0}
table{border-collapse:collapse;width:100%;break-inside:avoid}
thead{display:table-header-group}
tr{break-inside:avoid}
th,td{overflow-wrap:anywhere;vertical-align:top}
img{max-width:100%;height:auto;break-inside:avoid}
figure{text-align:center;break-inside:avoid}
figure svg{max-width:100%;height:auto}
figure.md-mermaid-error{text-align:left}
.md-mermaid-error p{color:#a11c18;font-size:.85em;margin:.4em 0 0}
.katex-display{overflow-x:auto;overflow-y:hidden;padding:.2em 0}
sup.md-fnref{font-size:.75em;line-height:0}
sup.md-fnref a{text-decoration:none}
.md-footnotes{margin-top:2.5em;padding-top:1em;font-size:.92em}
.md-footnotes ol{padding-left:1.4em}
.md-footnotes li{margin-top:.4em}
.md-footnotes .md-fnback{text-decoration:none;margin-left:.4em}
.md-toc{margin:0 0 2em}
.md-toc-title{font-weight:600;margin-bottom:.5em}
.md-toc ol{list-style:none;padding-left:0;margin:0;counter-reset:none}
.md-toc ol ol{padding-left:1.2em}
.md-toc li{margin:.2em 0}
.md-toc a{text-decoration:none}
`

const PRINT_CSS = `
@media print{
  html,body{background:#fff}
  #doc{max-width:none;margin:0;padding:0;background:none;box-shadow:none}
  a{color:inherit}
  pre,blockquote,table,figure,.md-toc{break-inside:avoid}
}
`

const round = (n: number) => Math.round(n * 100) / 100

/** Content box of one sheet, in mm — what the page guide and preview width use. */
export function pageBox(settings: DocSettings): { width: number; height: number; margin: number } {
  const paper = PAPERS.find((p) => p.id === settings.paper) ?? PAPERS[0]
  const margin = MARGINS.find((m) => m.id === settings.margin) ?? MARGINS[1]
  const width = settings.landscape ? paper.height : paper.width
  const height = settings.landscape ? paper.width : paper.height
  return {
    width: round(width - margin.mm * 2),
    height: round(height - margin.mm * 2),
    margin: margin.mm,
  }
}

function themeCss(theme: ThemeId): string {
  const rules = THEME_RULES[theme]
  return THEME_SELECTORS.map((selector) => `${selector}{${rules[selector]}}`).join('\n')
}

/** The whole document stylesheet for these settings. */
export function buildCss(settings: DocSettings): string {
  const box = pageBox(settings)
  const paper = PAPERS.find((p) => p.id === settings.paper) ?? PAPERS[0]

  const vars = `:root{--doc-font-size:${settings.fontSize}px;--doc-line-height:${settings.lineHeight};
  --doc-width:${box.width}mm;--doc-pad-x:${settings.pageGuide ? 0 : 6}mm;--doc-pad-y:${settings.pageGuide ? 0 : 6}mm}`

  const page = `@page{size:${paper.css}${settings.landscape ? ' landscape' : ' portrait'};margin:${box.margin}mm}`

  // Screen-only banding at one content-height interval. It cannot know that a
  // table refused to split, so the UI calls it a guide, not a page break.
  // The bands sit on #doc itself, whose content box starts exactly where the
  // text does — a wrapper with its own padding would offset every boundary.
  const guide = settings.pageGuide
    ? `@media screen{
  body{background:#e9e6df;padding:8mm 4mm}
  #doc{background-color:#fff;box-shadow:0 1px 6px rgba(0,0,0,.14);
    background-image:repeating-linear-gradient(to bottom,
      transparent 0 calc(${box.height}mm - 1px),
      rgba(0,0,0,.18) calc(${box.height}mm - 1px) ${box.height}mm)}
}`
    : ''

  return [
    vars,
    BASE_CSS,
    themeCss(settings.theme),
    settings.highlight ? HIGHLIGHT_CSS : '',
    page,
    guide,
    PRINT_CSS,
    settings.linkUrls
      ? `@media print{a[href^="http"]::after{content:" (" attr(href) ")";font-size:.82em;color:#555;word-break:break-all}}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

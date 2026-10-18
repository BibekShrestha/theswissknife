/**
 * Table discovery + grid building.
 *
 * Parsing goes through the browser's own HTML parser (DOMParser): pasted
 * markup is messy — unclosed tags, implied <tbody>, stray text — and nothing
 * hand-rolled matches a real parser's recovery. parseFromString never runs
 * scripts and these nodes never touch the live document, so pasted pages are
 * inert; we only ever read text out of them.
 */

export interface ExtractOptions {
  /** Squash every whitespace run (incl. &nbsp;) to one space. */
  collapseWhitespace: boolean
  /** What to do with <a href> inside a cell. */
  links: 'text' | 'url' | 'both'
}

export interface ExtractedTable {
  /** 1-based document order, used for labels and file names. */
  index: number
  caption: string
  /** Fully expanded grid — colspan/rowspan materialized into real cells. */
  rows: string[][]
  /** Leading rows that are headers (<thead>, or all-<th> rows at the top). */
  headerRowCount: number
  /** True when this table sits inside another table's cell. */
  nested: boolean
}

import { BLOCK, HTML_SPACE } from './blocks'

const MAX_COLSPAN = 1000

/**
 * Rows belonging to this table — not to a table nested inside its cells —
 * grouped by row group (thead / tbody / tfoot) and in the order a browser
 * draws them: the first <thead> on top and the first <tfoot> at the bottom
 * wherever they were written, every other group in source order between.
 */
function ownSections(table: Element): Element[][] {
  const groups: { parent: Element; rows: Element[] }[] = []
  for (const tr of Array.from(table.querySelectorAll('tr'))) {
    if (tr.closest('table') !== table) continue
    const parent = tr.parentElement ?? table
    const last = groups[groups.length - 1]
    if (last && last.parent === parent) last.rows.push(tr)
    else groups.push({ parent, rows: [tr] })
  }
  const head = groups.find((g) => g.parent.tagName === 'THEAD')
  const foot = groups.find((g) => g.parent.tagName === 'TFOOT')
  const middle = groups.filter((g) => g !== head && g !== foot)
  return [head, ...middle, foot].filter((g) => g !== undefined).map((g) => g.rows)
}

function span(value: string | null): number {
  const n = Number.parseInt(value ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}

/** rowspan="0" means "to the end of this section" in HTML; no span crosses one. */
function rowSpan(value: string | null, rowsLeft: number): number {
  if ((value ?? '').trim() === '0') return rowsLeft
  return Math.min(span(value), rowsLeft)
}

/**
 * Stands in for a line break at a block boundary until the text is read out.
 * The HTML parser turns U+0000 in text into U+FFFD, so it cannot be content.
 */
const BREAK = '\u0000'
const BREAK_RUN = new RegExp(`${HTML_SPACE}*${BREAK}[${BREAK}${HTML_SPACE.slice(1, -1)}]*`, 'g')

/** Content a browser does not show: no inline style is ever computed here, so only what the markup says. */
function isHidden(el: Element): boolean {
  if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return true
  const style = el.getAttribute('style') ?? ''
  return /(^|;)\s*(display\s*:\s*none|visibility\s*:\s*hidden)\s*(!important\s*)?(;|$)/i.test(style)
}

function cellText(cell: Element, opts: ExtractOptions): string {
  const clone = cell.cloneNode(true) as Element
  for (const el of Array.from(clone.querySelectorAll('script, style, template'))) el.remove()
  for (const el of Array.from(clone.querySelectorAll('*'))) if (isHidden(el)) el.remove()
  // A nested table's text would otherwise smear into this cell; it is
  // extracted separately as its own table, and leaves a line break.
  for (const el of Array.from(clone.querySelectorAll('table'))) el.replaceWith(BREAK)
  for (const br of Array.from(clone.querySelectorAll('br'))) br.replaceWith('\n')
  // An image says what it is through its alt text.
  for (const img of Array.from(clone.querySelectorAll('img'))) img.replaceWith(img.getAttribute('alt') ?? '')

  if (opts.links !== 'text') {
    for (const a of Array.from(clone.querySelectorAll('a[href]'))) {
      // Raw attribute, not a.href: resolving would silently graft this page's
      // origin onto relative URLs from somewhere else entirely.
      const href = (a.getAttribute('href') ?? '').trim()
      const label = (a.textContent ?? '').trim()
      if (opts.links === 'url') {
        a.replaceWith(href || label)
      } else {
        a.replaceWith(href && label && label !== href ? `${label} (${href})` : href || label)
      }
    }
  }

  // Block elements (<div>, <p>, <li>…) start a new line where they begin and
  // end, as they do on screen — "<div>a</div><div>b</div>" is two lines, not
  // "ab". Whitespace next to such a boundary does not render, so it goes too.
  for (const el of Array.from(clone.querySelectorAll('*'))) {
    if (!BLOCK.has(el.localName)) continue
    el.before(BREAK)
    el.after(BREAK)
  }

  const raw = (clone.textContent ?? '').replace(BREAK_RUN, '\n')
  return opts.collapseWhitespace ? raw.replace(/\s+/g, ' ').trim() : raw.trim()
}

function buildTable(table: Element, index: number, opts: ExtractOptions): ExtractedTable {
  const sections = ownSections(table)
  const trs = sections.flat()
  // Row index where each row's section ends, so spans stop at its edge.
  const sectionEnd: number[] = []
  let at0 = 0
  for (const rows of sections) {
    at0 += rows.length
    for (let k = 0; k < rows.length; k++) sectionEnd.push(at0)
  }
  const grid: string[][] = []
  const taken: boolean[][] = []

  const at = (r: number, c: number, text: string) => {
    grid[r] ??= []
    taken[r] ??= []
    grid[r][c] = text
    taken[r][c] = true
  }

  let headerRowCount = 0
  let sawBody = false

  trs.forEach((tr, r) => {
    const cells = Array.from(tr.children).filter(
      (el) => el.tagName === 'TD' || el.tagName === 'TH',
    )
    const isHeaderRow =
      tr.closest('thead') !== null ||
      (cells.length > 0 && cells.every((c) => c.tagName === 'TH'))
    if (isHeaderRow && !sawBody) headerRowCount = r + 1
    else if (cells.length > 0) sawBody = true

    let c = 0
    for (const cell of cells) {
      while (taken[r]?.[c]) c++
      const colspan = Math.min(span(cell.getAttribute('colspan')), MAX_COLSPAN)
      const rows = rowSpan(cell.getAttribute('rowspan'), sectionEnd[r] - r)
      const text = cellText(cell, opts)
      for (let dr = 0; dr < rows; dr++) {
        for (let dc = 0; dc < colspan; dc++) at(r + dr, c + dc, text)
      }
      c += colspan
    }
    grid[r] ??= []
  })

  // Ragged tables are normal in the wild — pad every row to the widest.
  const width = grid.reduce((w, row) => Math.max(w, row.length), 0)
  const rows = grid.map((row) => {
    const out = row.slice()
    out.length = width
    return Array.from(out, (v) => v ?? '')
  })

  const captionEl = Array.from(table.querySelectorAll('caption')).find(
    (el) => el.closest('table') === table,
  )

  return {
    index,
    caption: captionEl ? cellText(captionEl, opts) : '',
    rows,
    headerRowCount: Math.min(headerRowCount, rows.length),
    nested: table.parentElement?.closest('table') != null,
  }
}

export function extractTables(html: string, opts: ExtractOptions): ExtractedTable[] {
  if (!html.trim()) return []
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return Array.from(doc.querySelectorAll('table')).map((t, i) => buildTable(t, i + 1, opts))
}

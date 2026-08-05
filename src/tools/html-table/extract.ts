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

const MAX_COLSPAN = 1000

/** Rows belonging to this table — not to a table nested inside its cells. */
function ownRows(table: Element): Element[] {
  return Array.from(table.querySelectorAll('tr')).filter((tr) => tr.closest('table') === table)
}

function span(value: string | null): number {
  const n = Number.parseInt(value ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}

/** rowspan="0" means "to the end of this section" in HTML. */
function rowSpan(value: string | null, rowsLeft: number): number {
  if ((value ?? '').trim() === '0') return rowsLeft
  return Math.min(span(value), rowsLeft)
}

function cellText(cell: Element, opts: ExtractOptions): string {
  const clone = cell.cloneNode(true) as Element
  // A nested table's text would otherwise smear into this cell; it is
  // extracted separately as its own table.
  for (const el of Array.from(clone.querySelectorAll('table, script, style'))) el.remove()
  for (const br of Array.from(clone.querySelectorAll('br'))) br.replaceWith('\n')

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

  const raw = clone.textContent ?? ''
  return opts.collapseWhitespace ? raw.replace(/\s+/g, ' ').trim() : raw.trim()
}

function buildTable(table: Element, index: number, opts: ExtractOptions): ExtractedTable {
  const trs = ownRows(table)
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
      const rows = rowSpan(cell.getAttribute('rowspan'), trs.length - r)
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

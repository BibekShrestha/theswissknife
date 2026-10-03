/**
 * Batch input: one code per non-empty line. A tab splits an optional file
 * name from the content (`name<TAB>content`) — tabs are what a spreadsheet
 * column pair pastes as, and they almost never occur inside a URL.
 */

export interface BatchItem {
  name: string
  content: string
}

export const BATCH_LIMIT = 500

export function parseBatch(text: string): BatchItem[] {
  const used = new Map<string, number>()
  const items: BatchItem[] = []
  text.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) return
    const tab = line.indexOf('\t')
    const content = tab >= 0 ? line.slice(tab + 1) : line
    if (!content.trim()) return
    const base = slugify(tab >= 0 ? line.slice(0, tab) : '') || slugify(content) || 'qr'
    const index = items.length + 1
    const seen = used.get(base) ?? 0
    used.set(base, seen + 1)
    items.push({ name: `${String(index).padStart(3, '0')}-${seen ? `${base}-${seen + 1}` : base}`, content })
  })
  return items
}

/** File-system-safe, short, readable: `https://ex.com/a?b` → `ex-com-a-b`. */
export function slugify(text: string): string {
  return text
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:(\/\/)?/i, '')
    .replace(/^www\./i, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
    .toLowerCase()
}

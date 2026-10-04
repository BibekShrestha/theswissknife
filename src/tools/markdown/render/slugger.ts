/**
 * Heading ids for the table of contents and in-document anchors.
 *
 * GitHub-shaped so links pasted from a README keep working: lowercased,
 * punctuation dropped, each space to a dash (`a & b` → `a--b`, as GitHub
 * does). Duplicates get a numeric suffix — two "## Usage" sections are
 * common, and two identical ids would send every TOC entry to the first one.
 */
export function createSlugger() {
  const seen = new Map<string, number>()

  return function slug(text: string): string {
    const base =
      text
        .toLowerCase()
        .replace(/<[^>]*>/g, '') // heading text arrives with inline markup rendered
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .trim()
        .replace(/\s/g, '-') || 'section'

    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n === 1 ? base : `${base}-${n}`
  }
}

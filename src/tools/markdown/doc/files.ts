/**
 * Local files the document refers to — `![](images/plot.png)`,
 * `<img src="./logo.svg">`, `[the spec](spec.pdf)`. A pasted or opened .md
 * arrives without the files beside it, so the user attaches them and the
 * relative references resolve to those.
 *
 * Attachments live in memory only (a File and its blob: URL) — never storage,
 * never the URL. The site CSP allows blob: and data: images, so the preview
 * shows them; the export inlines images as data: URLs so the file stays
 * self-contained, and leaves links to other files relative, which works when
 * the .html is saved next to them.
 *
 * Matching: the reference's path, else a unique attachment whose path ends
 * with it (or it with the attachment's — `../img/a.png` finds `img/a.png`),
 * else a unique file name. Attachments from a file picker or a drop have no
 * folder, so the name is what usually matches.
 */

export interface LocalFile {
  /** As attached: a bare name, or a folder-relative path. */
  path: string
  name: string
  type: string
  size: number
  file: File
  /** blob: URL for the preview; revoked when the file is removed. */
  url: string
}

export const MAX_ATTACHMENT = 25 * 1024 * 1024

export function isImage(file: { type: string; name: string }): boolean {
  return file.type.startsWith('image/') || /\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i.test(file.name)
}

export function isMarkdown(file: { type: string; name: string }): boolean {
  return /\.(?:md|markdown|mdown|txt)$/i.test(file.name) || file.type === 'text/markdown' || file.type === 'text/plain'
}

/**
 * A relative reference as a plain path (decoded; no query, fragment, `.` or
 * `..` segments), or null when it is not a local file: any scheme (https:, blob:, data:,
 * mailto:), `//host`, `#fragment`, empty.
 */
export function localPath(ref: string): string | null {
  const raw = ref.trim()
  if (!raw || raw.startsWith('#') || raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return null
  let path = raw.replace(/[?#].*$/, '').replace(/\\/g, '/')
  try { path = decodeURIComponent(path) } catch { /* a lone % stays as written */ }
  const parts = path.split('/').filter((p) => p && p !== '.' && p !== '..')
  return parts.length ? parts.join('/') : null
}

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1)

const only = <T>(list: T[]): T | undefined => list.length === 1 ? list[0] : undefined

export function findFile(files: readonly LocalFile[], ref: string): LocalFile | undefined {
  const path = localPath(ref)
  if (!path || !files.length) return undefined
  const exact = files.find((f) => f.path === path)
  if (exact) return exact
  const suffix = only(files.filter((f) => f.path.endsWith('/' + path) || path.endsWith('/' + f.path)))
  if (suffix) return suffix
  const name = baseName(path).toLowerCase()
  return only(files.filter((f) => f.name.toLowerCase() === name))
}

export interface Localized {
  html: string
  /** Relative image references no attachment matched, in document order, once each. */
  missing: string[]
}

/**
 * Rewrites `<img src>` (and, with `links`, `<a href>`) that name an attached
 * file to `urlFor(file)`. `urlFor` returning null leaves that reference as
 * written. Parsed through an inert <template> like links.ts, so nothing loads
 * while it works.
 */
export function localizeHtml(
  html: string,
  files: readonly LocalFile[],
  urlFor: (file: LocalFile, kind: 'img' | 'a') => string | null,
  doc: Document = document,
): Localized {
  if (!html.includes('<img') && !(files.length && html.includes('<a'))) return { html, missing: [] }
  const template = doc.createElement('template')
  template.innerHTML = html
  const missing = new Set<string>()
  let changed = false
  for (const img of template.content.querySelectorAll('img[src]')) {
    const src = img.getAttribute('src')!
    if (!localPath(src)) continue
    const file = findFile(files, src)
    const url = file && urlFor(file, 'img')
    if (!file) missing.add(src)
    if (url) { img.setAttribute('src', url); changed = true }
  }
  if (files.length) {
    for (const a of template.content.querySelectorAll('a[href]')) {
      const file = findFile(files, a.getAttribute('href')!)
      const url = file && urlFor(file, 'a')
      if (url) { a.setAttribute('href', url); changed = true }
    }
  }
  return { html: changed ? template.innerHTML : html, missing: [...missing] }
}

export function dataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
}

/** A reference to `file` in Markdown, path percent-encoded where Markdown needs it. */
export function markdownRef(file: LocalFile): string {
  const target = file.path.replace(/[ ()<>%#?]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  const label = file.name.replace(/\.[^.]+$/, '').replace(/[[\]\\]/g, '')
  return isImage(file) ? `![${label}](${target})` : `[${file.name.replace(/[[\]\\]/g, '')}](${target})`
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Output file names. A batch download becomes a zip, so collisions matter:
 * three files called logo.png converted to WebP must not all be logo.webp.
 */

export const ZIP_NAME = 'converted-images.zip'

/** File name minus any directory prefix and extension, made safe for a zip. */
export function baseName(name: string): string {
  const leaf = name.split(/[\\/]/).pop() ?? ''
  const stem = leaf.replace(/\.[^.]+$/, '')
  // drop control characters and the bytes Windows refuses in a file name
  const safe = stem.replace(/[\u0000-\u001f<>:"|?*]/g, '').replace(/\s+/g, ' ').trim()
  return safe || 'image'
}

export function outputName(inputName: string, ext: string): string {
  return `${baseName(inputName)}.${ext}`
}

/**
 * Suffixes duplicates with " (2)", " (3)", … Comparison is case-insensitive
 * because Windows and macOS will happily merge Logo.webp with logo.webp.
 */
export function uniqueNames(names: string[]): string[] {
  const taken = new Set<string>()
  return names.map((name) => {
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    let candidate = name
    let n = 2
    while (taken.has(candidate.toLowerCase())) candidate = `${stem} (${n++})${ext}`
    taken.add(candidate.toLowerCase())
    return candidate
  })
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

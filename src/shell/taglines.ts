import { useEffect, useState } from 'react'
import type { ToolMeta } from './registry'

type Taglines = Record<string, string>

let loaded: Taglines | null = null
let pending: Promise<Taglines> | null = null

/** Taglines live in their own chunk (./tool-copy) so first paint doesn't carry them. */
export function loadTaglines(): Promise<Taglines> {
  pending ??= import('./tool-copy').then(
    (module) => (loaded = module.taglines),
    (error: unknown) => {
      // Offline before the chunk was ever cached: search keeps matching names,
      // and the next keystroke tries again.
      pending = null
      throw error
    },
  )
  return pending
}

/**
 * Taglines once there is a search query (the first keystroke), else null.
 * Search still works before they arrive — by name and category.
 */
export function useTaglines(query: string): Taglines | null {
  const [taglines, setTaglines] = useState(loaded)
  const searching = query.trim() !== ''
  useEffect(() => {
    if (!searching || taglines) return
    let live = true
    loadTaglines().then((value) => { if (live) setTaglines(value) }, () => {})
    return () => { live = false }
  }, [query, searching, taglines])
  return taglines
}

/**
 * The landing index and the sidebar filter match the same way: name, tagline,
 * and the category both as its id and as the heading shows it ("Images").
 */
export function toolMatches(tool: ToolMeta, query: string, taglines: Taglines | null, categoryName = ''): boolean {
  const value = query.trim().toLowerCase()
  return !value || `${tool.name} ${taglines?.[tool.slug] ?? ''} ${tool.category} ${categoryName}`.toLowerCase().includes(value)
}

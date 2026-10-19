/** Pure helpers behind the tree and hex view: flattening with expansion and per-node readings, offset lookup, and the hex window. */

import type { DNode } from '../types'

/** The reading picked for each node with several (by node id); absent means the decoder's default. */
export type ViewChoice = ReadonlyMap<string, number>

export function activeView(node: DNode, id: string, choice: ViewChoice): number {
  if (!node.views) return -1
  const picked = choice.get(id)
  return picked !== undefined && picked < node.views.length ? picked : node.view ?? 0
}

export function childrenOf(node: DNode, id: string, choice: ViewChoice): DNode[] {
  if (node.views) return node.views[activeView(node, id, choice)].children ?? []
  return node.children ?? []
}

/** Child ids carry the parent's reading, so switching it cannot alias the old children's state. */
export function childId(parentId: string, node: DNode, choice: ViewChoice, index: number): string {
  const v = node.views ? `v${activeView(node, parentId, choice)}` : ''
  return `${parentId}${v}.${index}`
}

export interface Row {
  id: string
  node: DNode
  depth: number
  parent: string | null
  hasChildren: boolean
  expanded: boolean
  posinset: number
  setsize: number
}

export function flatten(roots: DNode[], expanded: ReadonlySet<string>, choice: ViewChoice): Row[] {
  const rows: Row[] = []
  const visit = (nodes: DNode[], depth: number, parent: string | null, parentNode: DNode | null) => {
    nodes.forEach((node, i) => {
      const id = parent === null ? String(i) : childId(parent, parentNode!, choice, i)
      const kids = childrenOf(node, id, choice)
      const open = kids.length > 0 && expanded.has(id)
      rows.push({ id, node, depth, parent, hasChildren: kids.length > 0, expanded: open, posinset: i + 1, setsize: nodes.length })
      if (open) visit(kids, depth + 1, id, node)
    })
  }
  visit(roots, 0, null, null)
  return rows
}

/** Opens nodes breadth-first until about `budget` rows would show. */
export function initialExpansion(roots: DNode[], choice: ViewChoice, budget = 200, maxDepth = 8): Set<string> {
  const open = new Set<string>()
  let visible = roots.length
  let level: { id: string; node: DNode }[] = roots.map((node, i) => ({ id: String(i), node }))
  for (let depth = 0; depth < maxDepth && level.length; depth++) {
    const next: { id: string; node: DNode }[] = []
    for (const { id, node } of level) {
      const kids = childrenOf(node, id, choice)
      if (!kids.length) continue
      if (visible + kids.length > budget) return open
      open.add(id)
      visible += kids.length
      kids.forEach((kid, i) => next.push({ id: childId(id, node, choice, i), node: kid }))
    }
    level = next
  }
  return open
}

/** Ids from the root to the innermost node whose bytes include `offset` (map keys count as their entry). */
export function pathTo(roots: DNode[], offset: number, choice: ViewChoice): string[] {
  const path: string[] = []
  let nodes = roots
  let parent: { id: string; node: DNode } | null = null
  for (let guard = 0; guard < 1000; guard++) {
    let found = -1
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]
      const lo = n.key ? Math.min(n.key.start, n.start) : n.start
      if (offset >= lo && offset < n.end) {
        found = i
        break
      }
    }
    if (found < 0) break
    const node = nodes[found]
    const id: string = parent ? childId(parent.id, parent.node, choice, found) : String(found)
    path.push(id)
    parent = { id, node }
    nodes = childrenOf(node, id, choice)
  }
  return path
}

export const HEX_ROW_BYTES = 16
/** Browsers cap element heights (Firefox near 17.9M px); past this the scroll position is scaled. */
export const MAX_SCROLL_PX = 8_000_000

export interface HexWindow {
  first: number
  count: number
  /** Where the first rendered row sits inside the scroller's content. */
  top: number
  /** Height of the scroller's content. */
  total: number
}

export function hexWindow(scrollTop: number, viewHeight: number, rows: number, rowHeight: number): HexWindow {
  const visible = Math.ceil(viewHeight / rowHeight) + 1
  const natural = rows * rowHeight
  if (natural <= MAX_SCROLL_PX) {
    const first = Math.max(0, Math.min(rows - 1, Math.floor(scrollTop / rowHeight)))
    return { first, count: Math.max(0, Math.min(visible, rows - first)), top: first * rowHeight, total: natural }
  }
  const span = MAX_SCROLL_PX - viewHeight
  const ratio = span > 0 ? Math.min(1, Math.max(0, scrollTop / span)) : 0
  const first = Math.round(ratio * Math.max(0, rows - visible + 1))
  return { first, count: Math.min(visible, rows - first), top: Math.min(scrollTop, MAX_SCROLL_PX - viewHeight), total: MAX_SCROLL_PX }
}

/** The node an id points at (ids from flatten / pathTo), or null when the tree changed under it. */
export function nodeAt(roots: DNode[], id: string, choice: ViewChoice): DNode | null {
  const parts = id.split('.')
  let nodes = roots
  let node: DNode | null = null
  let prefix = ''
  for (let i = 0; i < parts.length; i++) {
    const index = Number(/^\d+/.exec(parts[i])?.[0] ?? NaN)
    node = nodes[index] ?? null
    if (!node) return null
    prefix = i === 0 ? String(index) : `${prefix}.${index}`
    if (i < parts.length - 1) {
      const v = /v(\d+)$/.exec(parts[i])
      if (v && (!node.views || activeView(node, prefix, choice) !== Number(v[1]))) return null
      nodes = childrenOf(node, prefix, choice)
      if (v) prefix += `v${v[1]}`
    }
  }
  return node
}

/** What a row shows: the chosen reading's summary for nodes with several. */
export function displayOf(node: DNode, id: string, choice: ViewChoice): { value: string; kind: string } {
  if (!node.views) return { value: node.value ?? '', kind: node.kind }
  const view = node.views[activeView(node, id, choice)]
  return { value: view.value, kind: `${node.kind} · ${view.kind ?? view.name}` }
}

/** The scrollTop that puts `row` at the top of the hex view (inverse of hexWindow). */
export function scrollTopForRow(row: number, viewHeight: number, rows: number, rowHeight: number): number {
  const natural = rows * rowHeight
  if (natural <= MAX_SCROLL_PX) return row * rowHeight
  const visible = Math.ceil(viewHeight / rowHeight) + 1
  const span = MAX_SCROLL_PX - viewHeight
  return (row / Math.max(1, rows - visible + 1)) * span
}

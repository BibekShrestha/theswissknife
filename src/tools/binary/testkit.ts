/** Test helpers: hex to bytes, and a decoded tree back to diagnostic notation (RFC 8949 §8) for comparing against spec vectors. */

import type { DNode } from './types'

export function hex(text: string): Uint8Array {
  const digits = text.replace(/\s+/g, '')
  const out = new Uint8Array(digits.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(digits.substr(i * 2, 2), 16)
  return out
}

export function notation(node: DNode): string {
  const kids = node.children ?? []
  const indef = node.indef ? '_ ' : ''
  switch (node.syn) {
    case 'array':
      return `[${indef}${kids.map(notation).join(', ')}]`
    case 'map':
      return `{${indef}${kids.map((v) => `${notation(v.key!)}: ${notation(v)}`).join(', ')}}`
    case 'tag':
      return `${node.tag}(${notation(kids[0])})`
    case 'chunks':
      return `(_ ${kids.map(notation).join(', ')})`
  }
  return node.value ?? ''
}

/** Every node in a tree, children of every view included. */
export function* walk(nodes: DNode[]): Generator<DNode> {
  for (const node of nodes) {
    yield node
    if (node.key) yield* walk([node.key])
    if (node.children) yield* walk(node.children)
    for (const view of node.views ?? []) if (view.children && view.children !== node.children) yield* walk(view.children)
  }
}

/** A small deterministic PRNG so fuzz failures reproduce. */
export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

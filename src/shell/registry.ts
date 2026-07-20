import type { ComponentType } from 'react'

/**
 * The single place tools are registered. A tool is one folder under
 * src/tools/<slug>/ whose index.tsx default-exports its component; the
 * dynamic import here is what makes it a lazy chunk — tool code loads
 * only when its route is opened.
 */

export interface ToolMeta {
  slug: string
  name: string
  tagline: string
  /** Short glyph shown on the landing card. */
  icon: string
  load: () => Promise<{ default: ComponentType }>
}

export const tools: ToolMeta[] = [
  {
    slug: 'jq',
    name: 'jq playground',
    tagline: 'Run real jq 1.8.2 on your JSON — every flag, autocomplete, all in your browser',
    icon: '{ }',
    load: () => import('../tools/jq'),
  },
  {
    slug: 'jwt',
    name: 'JWT decode & generate',
    tagline: 'Decode, verify, generate and sign JSON Web Tokens — keys never leave your machine',
    icon: '🔏',
    load: () => import('../tools/jwt'),
  },
]

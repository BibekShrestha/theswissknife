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
  /** Short typographic mark shown on the landing card. */
  mark: string
  category: 'data' | 'security' | 'text' | 'time' | 'pdf' | 'image'
  load: () => Promise<{ default: ComponentType }>
}

export const tools: ToolMeta[] = [
  {
    slug: 'jq',
    name: 'jq playground',
    tagline: 'Run real jq 1.8.2 on your JSON — every flag, autocomplete, all in your browser',
    mark: 'jq',
    category: 'data',
    load: () => import('../tools/jq'),
  },
  {
    slug: 'jwt',
    name: 'JWT decode & generate',
    tagline: 'Decode, verify, generate and sign JSON Web Tokens — keys never leave your machine',
    mark: 'JWT',
    category: 'security',
    load: () => import('../tools/jwt'),
  },
  {
    slug: 'regex',
    name: 'Regex lab',
    tagline: 'Match, replace and compare JavaScript with PCRE2 in a guarded local worker',
    mark: '.*',
    category: 'text',
    load: () => import('../tools/regex'),
  },
  {
    slug: 'codec',
    name: 'Codec studio',
    tagline: 'Encode and decode Base64, URLs, HTML entities and UTF-8 hex without uploads',
    mark: '⇄',
    category: 'text',
    load: () => import('../tools/codec'),
  },
  {
    slug: 'time',
    name: 'Unix time',
    tagline: 'Convert seconds through nanoseconds into precise local, UTC and zoned time',
    mark: 'UTC',
    category: 'time',
    load: () => import('../tools/time'),
  },
  {
    slug: 'pdf',
    name: 'PDF Buddy',
    tagline: 'Merge, split, convert, compress, watermark, protect, and unlock PDFs — all client-side',
    mark: 'PDF',
    category: 'pdf',
    load: () => import('../tools/pdf'),
  },
  {
    slug: 'image',
    name: 'Image converter',
    tagline: 'Convert, resize and compress JPEG, PNG, WebP and GIF — batch, with a size target',
    mark: 'IMG',
    category: 'image',
    load: () => import('../tools/image'),
  },
  {
    slug: 'html-table',
    name: 'HTML table extractor',
    tagline: 'Pull any HTML table into CSV, JSON or Markdown — colspan and rowspan handled',
    mark: '▦',
    category: 'data',
    load: () => import('../tools/html-table'),
  },
]

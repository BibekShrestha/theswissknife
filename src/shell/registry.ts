import type { ComponentType } from 'react'

/**
 * The single place tools are registered. A tool is one folder under
 * src/tools/<slug>/ whose index.tsx default-exports its component; the
 * dynamic import here is what makes it a lazy chunk — tool code loads
 * only when its route is opened.
 *
 * This file ships in the entry chunk, so it holds only what first paint
 * draws. Each tool's tagline lives in ./tool-copy.ts, which loads with the
 * palette or the first search keystroke.
 */

export interface ToolMeta {
  slug: string
  name: string
  /** Short typographic mark shown on the landing card. */
  mark: string
  category: 'data' | 'security' | 'text' | 'docs' | 'time' | 'pdf' | 'image'
  load: () => Promise<{ default: ComponentType }>
}

export const tools: ToolMeta[] = [
  {
    slug: 'jq',
    name: 'jq playground',
    mark: 'jq',
    category: 'data',
    load: () => import('../tools/jq'),
  },
  {
    slug: 'jwt',
    name: 'JWT decode & generate',
    mark: 'JWT',
    category: 'security',
    load: () => import('../tools/jwt'),
  },
  {
    slug: 'ssl',
    name: 'SSL certificate verifier',
    mark: 'TLS',
    category: 'security',
    load: () => import('../tools/ssl'),
  },
  {
    slug: 'hash',
    name: 'Hash & HMAC',
    mark: '#',
    category: 'security',
    load: () => import('../tools/hash'),
  },
  {
    slug: 'regex',
    name: 'Regex lab',
    mark: '.*',
    category: 'text',
    load: () => import('../tools/regex'),
  },
  {
    slug: 'redact',
    name: 'Text redactor',
    mark: '█',
    category: 'text',
    load: () => import('../tools/redact'),
  },
  {
    slug: 'codec',
    name: 'Codec studio',
    mark: '⇄',
    category: 'text',
    load: () => import('../tools/codec'),
  },
  {
    slug: 'diff',
    name: 'Diff',
    mark: '±',
    category: 'text',
    load: () => import('../tools/diff'),
  },
  {
    slug: 'markdown',
    name: 'Markdown preview & export',
    mark: 'M↓',
    category: 'docs',
    load: () => import('../tools/markdown'),
  },
  {
    slug: 'time',
    name: 'Unix time',
    mark: 'UTC',
    category: 'time',
    load: () => import('../tools/time'),
  },
  {
    slug: 'cron',
    name: 'Cron explainer',
    mark: '*/5',
    category: 'time',
    load: () => import('../tools/cron'),
  },
  {
    slug: 'dates',
    name: 'Dates & time zones',
    mark: 'TZ',
    category: 'time',
    load: () => import('../tools/dates'),
  },
  {
    slug: 'pdf',
    name: 'PDF Buddy',
    mark: 'PDF',
    category: 'pdf',
    load: () => import('../tools/pdf'),
  },
  {
    slug: 'image',
    name: 'Image converter',
    mark: 'IMG',
    category: 'image',
    load: () => import('../tools/image'),
  },
  {
    slug: 'qr',
    name: 'QR code generator & scanner',
    mark: 'QR',
    category: 'image',
    load: () => import('../tools/qr'),
  },
  {
    slug: 'csv',
    name: 'CSV viewer',
    mark: 'CSV',
    category: 'data',
    load: () => import('../tools/csv'),
  },
  {
    slug: 'html-table',
    name: 'HTML table extractor',
    mark: '▦',
    category: 'data',
    load: () => import('../tools/html-table'),
  },
  {
    slug: 'uuid',
    name: 'UUID & ULID',
    mark: 'ID',
    category: 'data',
    load: () => import('../tools/uuid'),
  },
  {
    slug: 'convert',
    name: 'YAML / JSON / TOML converter',
    mark: 'YJT',
    category: 'data',
    load: () => import('../tools/convert'),
  },
  {
    slug: 'sqlite',
    name: 'SQLite viewer',
    mark: 'SQL',
    category: 'data',
    load: () => import('../tools/sqlite'),
  },
  {
    slug: 'curl',
    name: 'cURL converter',
    mark: 'cURL',
    category: 'data',
    load: () => import('../tools/curl'),
  },
]

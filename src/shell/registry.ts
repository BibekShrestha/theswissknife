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
  category: 'data' | 'security' | 'text' | 'docs' | 'time' | 'pdf' | 'image'
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
    slug: 'ssl',
    name: 'SSL certificate verifier',
    tagline: 'Inspect certificates, check expiry and hostname coverage, and verify chain signatures locally',
    mark: 'TLS',
    category: 'security',
    load: () => import('../tools/ssl'),
  },
  {
    slug: 'regex',
    name: 'Regex lab',
    tagline: 'Match and replace with JavaScript regex in a local worker that stops runaway patterns',
    mark: '.*',
    category: 'text',
    load: () => import('../tools/regex'),
  },
  {
    slug: 'redact',
    name: 'Text redactor',
    tagline: 'Black out text with block characters — the shape stays, the words are gone for good',
    mark: '█',
    category: 'text',
    load: () => import('../tools/redact'),
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
    slug: 'markdown',
    name: 'Markdown preview & export',
    tagline: 'Live Markdown preview with math and diagrams — export one self-contained HTML file or a PDF',
    mark: 'M↓',
    category: 'docs',
    load: () => import('../tools/markdown'),
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
    slug: 'qr',
    name: 'QR code generator',
    tagline: 'Make QR codes for links, Wi-Fi, contacts and events — logos, colours, batch ZIP, all offline',
    mark: 'QR',
    category: 'image',
    load: () => import('../tools/qr'),
  },
  {
    slug: 'csv',
    name: 'CSV viewer',
    tagline: 'Paste or drop a CSV and read it as a real table — sort, search, edit and export offline',
    mark: 'CSV',
    category: 'data',
    load: () => import('../tools/csv'),
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

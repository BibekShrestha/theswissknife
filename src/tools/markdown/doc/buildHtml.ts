import { escapeHtml } from '../render/highlight'
import { disarmHtml } from './links'

/**
 * The standalone export: one .html file with every style inlined, so it opens
 * anywhere — from an email attachment, a USB stick, `file://` — with no
 * requests to this site or anyone else for its own presentation.
 *
 * The file carries a CSP of its own. The preview frame never runs script, but
 * an exported file is opened in an ordinary tab where it would — so a raw
 * `<script>` (or `javascript:` link) someone pasted into the Markdown stays
 * inert there too. Images stay allowed from anywhere: they are the author's
 * content, not ours. The body is also disarmed (links.ts): no meta refresh,
 * no <base>, no form that submits anywhere, no script URLs — and the CSP's
 * form-action and base-uri say the same for browsers that read them.
 * Ordinary links still work; they open in a new tab.
 */

export const EXPORT_CSP = "default-src 'none'; img-src * data: blob:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'"

export interface ExportInput {
  title: string
  /** Rendered document, TOC included. */
  body: string
  /** Document stylesheet (theme, paper, highlight) plus any math CSS. */
  css: string
}

export function buildHtml({ title, body, css }: ExportInput): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${EXPORT_CSP}">
<meta name="generator" content="The Swiss Knife — theswissknife.com/markdown">
<title>${escapeHtml(title || 'Document')}</title>
<style>
${css}
</style>
</head>
<body>
<main id="doc">
${disarmHtml(body)}
</main>
</body>
</html>
`
}

/** A file-system-safe base name from the document title. */
export function fileBase(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .toLowerCase() || 'document'
}

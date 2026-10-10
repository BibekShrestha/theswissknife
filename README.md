# The Swiss Knife

**Live: <https://theswissknife.com>** *(GitHub Pages: <https://bibekshrestha.github.io/theswissknife/>)*

Sharp little developer tools, each at its own path, all running **entirely in your
browser** — nothing you paste ever leaves your machine.

Installable, and it works with the network off: the shell is cached on first
visit, and each tool is kept once you've opened it — jq's WebAssembly and PDF
Buddy's pdf.js engine included.

| Tool | Path | What it does |
|---|---|---|
| jq playground | [/jq](https://theswissknife.com/jq) | Real jq 1.8.2 (WebAssembly) with every CLI flag, input-aware autocomplete, examples, shareable links |
| JWT decode & generate | [/jwt](https://theswissknife.com/jwt) | Decode, verify and sign JWTs (HS/RS/PS/ES/EdDSA) via WebCrypto |
| SSL certificate verifier | [/ssl](https://theswissknife.com/ssl) | Inspect X.509 certificates, check expiry and hostname coverage, and verify supplied chain signatures locally |
| Regex lab | [/regex](https://theswissknife.com/regex) | Match and replace with JavaScript regular expressions in a worker that is stopped if a pattern backtracks catastrophically |
| Text redactor | [/redact](https://theswissknife.com/redact) | Mask text with block characters, pick what to hide, share the scheme as a link |
| Codec studio | [/codec](https://theswissknife.com/codec) | Encode and decode Base64, URLs, HTML entities and UTF-8 hex |
| Markdown preview & export | [/markdown](https://theswissknife.com/markdown) | Live GitHub-flavoured Markdown preview with footnotes, KaTeX math and mermaid diagrams; export one self-contained HTML file, or a PDF through the print dialog, with themes, paper sizes and a table of contents |
| Unix time | [/time](https://theswissknife.com/time) | Convert seconds through nanoseconds into local, UTC and zoned time |
| PDF Buddy | [/pdf](https://theswissknife.com/pdf) | Merge, split, reorder, rotate, compress, watermark, number, protect and unlock PDFs |
| Image converter | [/image](https://theswissknife.com/image) | Batch convert, resize and compress PNG/JPEG/WebP/GIF (SVG in), aim for a target file size |
| QR code generator & scanner | [/qr](https://theswissknife.com/qr) | QR codes for text, URLs, Wi-Fi, email, SMS, contacts, locations and events; custom colours, shapes and logos, a scan check, PNG/SVG/JPEG/WebP export and batch ZIP. Scan reads every code in a chosen, dropped or pasted image (ZXing-C++, then the browser's own BarcodeDetector where it has one, then OpenCV's WeChat decoder) and lays out Wi-Fi, contact and event fields |
| CSV viewer | [/csv](https://theswissknife.com/csv) | Paste, drop or open a CSV/TSV and read it as a sortable, searchable, editable table — filter by column, group by value with counts and sums; export CSV, TSV, JSON or Markdown |
| HTML table extractor | [/html-table](https://theswissknife.com/html-table) | Pull any HTML table into CSV, TSV, JSON or Markdown — colspan and rowspan handled |

## Develop

```sh
npm install
npm run dev      # dev server (deep links like /jq work)
npm test         # unit + integration tests (runs the real wasm jq)
npm run build    # production build → dist/ (+ 404.html SPA fallback)
npm run icons    # regenerate the PWA icons from the site mark (one-shot)
```

The service worker is only registered in a production build, so `npm run dev`
never serves you a stale cache. To exercise offline behaviour, build and serve
`dist/` over http://localhost (a secure context) rather than opening the files
directly.

Architecture and the **rules for adding a tool** live in [AGENTS.md](AGENTS.md)
(`CLAUDE.md` imports it) — short version: one folder under `src/tools/<slug>/`,
one entry in `src/shell/registry.ts` and one row in the table above, and the
tool becomes a lazy chunk loaded only when its route opens.

## Deployment

Every push to `main` runs the test suite and deploys to GitHub Pages
(`.github/workflows/deploy.yml`). PRs run the same checks via `ci.yml`.

### Custom domain runbook (theswissknife.com)

One-time DNS setup at the domain registrar:

1. Apex `theswissknife.com` → **A records**: `185.199.108.153`, `185.199.109.153`,
   `185.199.110.153`, `185.199.111.153` (optionally AAAA `2606:50c0:8000::153`
   … `:8003::153`).
2. Optional `www` → **CNAME** `bibekshrestha.github.io`.
3. Then: set the custom domain on the repo (Settings → Pages, or
   `gh api repos/BibekShrestha/theswissknife/pages -X PUT -f cname=theswissknife.com`),
   switch `BASE_PATH` to `/` in `deploy.yml`, redeploy, and enable
   **Enforce HTTPS** once the certificate is issued.

## jq engine notes

- The wasm jq is the real binary — feature parity is exact. `--args`/`--jsonargs`
  can't be used in-engine (the wrapper's argv appends the query and `/dev/stdin`),
  so positional args are emulated by rebinding `$ARGS`; "Copy command" emits the
  real flags for terminal use.
- A single argv token near 1 MB crashes the wasm and poisons the instance; the app
  guards values at 512 KB and auto-reloads the engine after any crash. Big data
  belongs in the input pane (stdin).
- `leaf_paths` was removed in jq 1.8 — use `paths(scalars)`.
- The integration tests run every example and cheatsheet snippet through the real
  engine so a jq upgrade can't silently break them.

## License

MIT — see [LICENSE](LICENSE).

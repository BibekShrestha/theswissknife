# The Swiss Knife

**Live: <https://theswissknife.com>** *(GitHub Pages: <https://bibekshrestha.github.io/theswissknife/>)*

Sharp little developer tools, each at its own path, all running **entirely in your
browser** — nothing you paste ever leaves your machine.

| Tool | Path | What it does |
|---|---|---|
| jq playground | [/jq](https://theswissknife.com/jq) | Real jq 1.8.2 (WebAssembly) with every CLI flag, input-aware autocomplete, examples, shareable links |
| JWT decoder | [/jwt](https://theswissknife.com/jwt) | Decode, verify and sign JWTs (HS/RS/PS/ES/EdDSA) via WebCrypto |
| Regex lab | [/regex](https://theswissknife.com/regex) | Match, replace and compare JavaScript against PCRE2 in a worker guarded against runaway patterns |
| Text redactor | [/redact](https://theswissknife.com/redact) | Mask text with block characters, choosing how much of the shape survives |
| Codec studio | [/codec](https://theswissknife.com/codec) | Encode and decode Base64, URLs, HTML entities and UTF-8 hex |
| Unix time | [/time](https://theswissknife.com/time) | Convert seconds through nanoseconds into local, UTC and zoned time |
| PDF Buddy | [/pdf](https://theswissknife.com/pdf) | Merge, split, reorder, rotate, compress, watermark, number, protect and unlock PDFs |
| Image converter | [/image](https://theswissknife.com/image) | Batch convert, resize and compress PNG/JPEG/WebP/GIF (SVG in), aim for a target file size |
| HTML table extractor | [/html-table](https://theswissknife.com/html-table) | Pull any HTML table into CSV, TSV, JSON or Markdown — colspan and rowspan handled |

## Develop

```sh
npm install
npm run dev      # dev server (deep links like /jq work)
npm test         # unit + integration tests (runs the real wasm jq)
npm run build    # production build → dist/ (+ 404.html SPA fallback)
```

Architecture and the **rules for adding a tool** live in [CLAUDE.md](CLAUDE.md) —
short version: one folder under `src/tools/<slug>/`, one entry in
`src/shell/registry.ts`, and the tool becomes a lazy chunk loaded only when its
route opens.

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

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
| Hash & HMAC | [/hash](https://theswissknife.com/hash) | SHA-1/256/384/512 digests and HMACs (text, hex or Base64 key) of UTF-8 text or a local file via WebCrypto, in hex or Base64; paste an expected checksum (or a `sha256sum` line) to see which one matches |
| Regex lab | [/regex](https://theswissknife.com/regex) | JavaScript regular expressions with matches and capture groups highlighted in the text, should-match / should-not-match test cases, a plain-language explanation that warns about nested quantifiers, share links and copy as JS — every run in a worker that is stopped if a pattern backtracks catastrophically |
| Text redactor | [/redact](https://theswissknife.com/redact) | Mask text with block characters, pick what to hide, share the scheme as a link |
| Codec studio | [/codec](https://theswissknife.com/codec) | Encode and decode Base64, URLs, HTML entities and UTF-8 hex |
| Diff | [/diff](https://theswissknife.com/diff) | Compare text or JSON (keys sorted, so order and formatting don't count) with word-level highlights; copy or download a unified diff |
| Markdown preview & export | [/markdown](https://theswissknife.com/markdown) | Live GitHub-flavoured Markdown preview with footnotes, KaTeX math and mermaid diagrams; export one self-contained HTML file, or a PDF through the print dialog, with themes, paper sizes and a table of contents |
| Unix time | [/time](https://theswissknife.com/time) | Convert seconds through nanoseconds into local, UTC and zoned time |
| Cron explainer | [/cron](https://theswissknife.com/cron) | Explain five-field cron expressions (lists, ranges, steps, names, @macros) in plain English, flag the day-of-month / day-of-week OR rule, and list the next run times in any IANA time zone with DST gaps and repeats handled |
| Dates & time zones | [/dates](https://theswissknife.com/dates) | Meeting planner: hour strips for several IANA zones (search by city or abbreviation, ambiguous ones flagged) aligned on the same instants across DST and 30/45-minute offsets, working-hours overlap, copy the time for every zone or download an .ics event. Durations: difference between two zoned date-times (exact totals, calendar breakdown, Mon–Fri business days, ISO 8601), and add or subtract an ISO 8601 duration with calendar vs exact results and month-end clamping shown |
| PDF Buddy | [/pdf](https://theswissknife.com/pdf) | Merge, split, reorder, rotate, compress, watermark, number, protect and unlock PDFs |
| Image converter | [/image](https://theswissknife.com/image) | Batch convert, resize and compress PNG/JPEG/WebP/GIF (SVG in), aim for a target file size |
| QR code generator & scanner | [/qr](https://theswissknife.com/qr) | QR codes for text, URLs, Wi-Fi, email, SMS, contacts, locations and events; custom colours, shapes and logos, a scan check, PNG/SVG/JPEG/WebP export and batch ZIP. Scan reads every code in a chosen, dropped or pasted image (ZXing-C++, then the browser's own BarcodeDetector where it has one, then OpenCV's WeChat decoder) and lays out Wi-Fi, contact and event fields |
| Photo metadata viewer & stripper | [/exif](https://theswissknife.com/exif) | Read every metadata block in JPEG, PNG, WebP, GIF, HEIC and AVIF files — EXIF (camera, lens, dates, GPS in decimal and DMS, the IFD1 thumbnail and its own EXIF), XMP including JPEG extended XMP, IPTC, ICC, MPF, comments and data after the image. Strip in batch by rewriting the container (HEIC/AVIF: Exif and XMP items zeroed in place) so image data stays byte-identical; optionally keep orientation and the colour profile; every output is parsed again to show what remains; download one file or a ZIP |
| CSV viewer | [/csv](https://theswissknife.com/csv) | Paste, drop or open a CSV/TSV and read it as a sortable, searchable, editable table — filter by column, group by value with counts and sums; export CSV, TSV, JSON or Markdown |
| HTML table extractor | [/html-table](https://theswissknife.com/html-table) | Pull any HTML table into CSV, TSV, JSON or Markdown — colspan and rowspan handled |
| UUID & ULID | [/uuid](https://theswissknife.com/uuid) | Generate UUID v4, v7 and ULID batches; inspect version, variant, embedded timestamp, clock sequence and node, and convert between UUID, ULID, hex, base64url and bytes |
| YAML / JSON / TOML converter | [/convert](https://theswissknife.com/convert) | Convert between YAML 1.2, JSON and TOML 1.0 with auto-detect, 2/4 indent and key sorting; integers past 2^53 stay exact; errors give line and column, and dropped nulls, expanded anchors, lost comments and tags, TOML dates turned into strings and big integers in JSON output are listed as warnings |
| TOTP & HOTP | [/otp](https://theswissknife.com/otp) | HOTP (RFC 4226) and TOTP (RFC 6238) codes with SHA-1/256/512 and 6–8 digits via WebCrypto, from a Base32 secret, an otpauth:// URI, a Google Authenticator `otpauth-migration://` export (every account, multi-QR batches) or dropped QR images (ZXing-C++); countdown, neighbouring windows for clock-skew debugging, check a code against ±N windows, editable HOTP counter, and an otpauth:// URI and QR code per account to re-import elsewhere. Secrets are hidden until revealed and never stored |
| SQLite viewer | [/sqlite](https://theswissknife.com/sqlite) | Open a .db/.sqlite file or start empty: schema with row counts, paged sortable tables, multi-statement SQL in a worker that stops runaway queries; export results as CSV/JSON and the edited database as .sqlite — the original file is never changed |
| cURL converter | [/curl](https://theswissknife.com/curl) | Read Chrome, Firefox and Safari “Copy as cURL” (bash quoting, `$'…'` strings, or Windows cmd `^` escapes, auto-detected) and show the request — method, query, headers, decoded JSON, form and multipart bodies — as JavaScript fetch, Python requests, Go net/http, raw HTTP/1.1 or clean curl; unknown flags and shell constructs are listed as warnings; a Secrets panel flags Authorization, cookies, -u, API-key headers and token/key/password fields and replaces them with placeholders everywhere. The request is never sent |

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

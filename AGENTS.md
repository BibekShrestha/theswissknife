# The Swiss Knife

Multi-tool developer site (theswissknife.com): a landing page plus dedicated,
fully client-side tools under path routes (`/jq`, `/jwt`, …). Vite + React 19 +
TypeScript, deployed to GitHub Pages by `.github/workflows/deploy.yml`
(tests gate every deploy; `ci.yml` runs the same checks on PRs).

This file is the single source of truth for agents. `CLAUDE.md` only imports
it — edit here.

## Architecture — read this before changing anything

```
src/
  main.tsx          bootstrap
  sw.ts             service worker — self-contained, emitted as /sw.js
  shell/            router, registry, landing, sidebar, palette, theme — SMALL and STABLE
  tools/<slug>/     ONE FOLDER PER TOOL — everything the tool needs
scripts/            build-time helpers (bundle check, sw precache, SEO metadata, icons)
```

**A tool is one folder plus one registry line** (plus its tagline and a README
row). To add one:

1. Create `src/tools/<slug>/index.tsx` default-exporting the tool component.
   Put ALL of its code there: components, helpers, workers, styles
   (`import './<slug>.css'`), tests (`*.test.ts`).
2. Add one entry to `src/shell/registry.ts` (`slug`, `name`, `mark`,
   `category`, and a `load: () => import(...)` thunk). That dynamic import is
   what makes the tool a lazy chunk. `category` must be one of the ids in
   `categories` in `src/shell/Landing.tsx`.
3. Add its one-line `tagline` to `src/shell/tool-copy.ts`, keyed by slug. It is
   kept out of the registry because the registry ships in the entry chunk;
   the palette and search load taglines lazily.
4. Add a row to the tool table in `README.md` — `| <name> | [/<slug>](https://theswissknife.com/<slug>) | … |`,
   with `<name>` exactly as in the registry.

Everything else derives from the registry: landing page, sidebar, ⌘K palette,
sitemap, landing JSON-LD and meta description (`scripts/tool-meta.ts`), and the
build's lazy-chunk check. `src/shell/main-pages.test.ts` fails if a tool is
missing from any of them, including the README table.

## Hard rules

- **Never import from another tool's folder.** Tools may import ONLY from
  their own folder and these `src/shell/` modules:
  - `router.ts`: `Link`/`navigate`/`usePath`
  - `theme.ts`: `useTheme`
  - `ToolHeader.tsx`: the shared toolbar (menu, home mark, brand, ⌘K search,
    GitHub, theme toggle). Pass `brand` (rendered as the page's `<h1>`, so a
    tool's own titles start at `<h2>`), optional `localLabel`, optional
    `beforeSwitcher` (tabs, badges) and `children` (action buttons after the
    spacer).
  - `useToast.ts`: `{ toast, showToast }` — 4 s toast state.
  - `Toast.tsx`: render the state as `<Toast message={toast} />`, always
    mounted — a live region created together with its text often goes
    unannounced.
  - `useCopy.ts`: `useCopy(showToast)` — clipboard helper with toast feedback.
  - `handoff.ts`: `sendTo(slug, { name, text?, bytes?, type? })` hands one
    payload to another tool and navigates there; that tool calls
    `takeHandoff(slug)` on mount (single use, memory only — never the URL or
    storage, since it is the user's data).

  Everything else in `shell/` (App, Landing, ToolSidebar, CommandPalette,
  palette, sidebar, BladeMark, ErrorBoundary, pwa, taglines, tool-copy) is
  shell-internal; App
  already wraps every tool in `ErrorBoundary` and `Suspense`.
- **Keep the shell tiny.** Shared additions must be generic UI patterns (toast,
  toolbar, copy) — never tool-specific logic. Anything with a tool's flavour
  (JSON colorizer, drop zones, share-link codecs) is intentionally duplicated
  per tool so each folder stays self-contained and an agent can work on one
  tool with small context.
- **Everything runs client-side.** No network calls with user data, ever —
  the site's promise is "nothing you paste leaves your machine". (`fetch` of a
  local `blob:`/`data:` URL is fine.)
- **Say only what the tool does.** Taglines, README rows and UI copy must match
  shipped behaviour — don't advertise an engine, mode or guard that isn't
  wired up.
- **Tools must stay lazy.** Nothing outside `shell/` may be imported by
  `main.tsx`/landing. `npm run build` ends with `scripts/check-bundle.mjs`:
  the entry chunk plus its static imports is ~66.3 KiB gz (react + shell +
  registry) against a budget of 65.9 KiB + 0.08 KiB per tool, so registry
  lines alone never trip it. Adding a tool should move it by ~0.05 KiB (its
  registry line; taglines load lazily); a jump of kilobytes means the tool
  leaked into the eager graph.
- **Sub-tools within a tool must also be lazy** when there are many (PDF
  Buddy's 13 sub-tools are each a `lazy()` chunk), and so must heavy optional
  paths (image's GIF encoder, pdf.js).
- **Untrusted work goes in a worker with a deadline** when it can hang: jq runs
  in workers that are reloaded after a crash; regex runs in a worker that is
  terminated on timeout (`tools/regex/runner.ts`).
- **Accessibility guards** (`src/shell/a11y.test.ts`): every tool has an
  element with `id="main-content"` (the skip link's target), toasts go
  through `<Toast>`, and icon spans are `aria-hidden` — their ligature text
  ("content_copy") is otherwise read aloud, so put the label on the button.
  Older offenders are listed in `src/shell/a11y-baseline.json`; counts may
  only go down.
- Use the CSS variables from `src/shell/theme.css` (both themes come free).
  Text on an accent fill uses `--on-accent` (white fails contrast on the dark
  accent); form-field outlines use `--control-border` (≥3:1 on every surface).
  Corners are square: use the `--radius-*` tokens (all 0), never a px radius —
  pills (`--radius-pill`) are for status badges and toasts, `50%` for dots.
  Sizes come from `--fs-*` (10.5px floor, mono labels only), uppercase mono
  labels from `font: var(--label); letter-spacing: var(--label-track)`, and
  spacing/elevation from `--sp-*` / `--elev-*`. Text is the platform UI font;
  `--font-display` (self-hosted Inter Tight subset) is for the hero and brands.
  Prefix tool class names with the slug (`.jwt-…`) to avoid collisions —
  tool CSS is global once loaded. `html-table` uses `htable-`. jq predates the
  rule and still has unprefixed classes; don't copy that, and don't add new
  bare class names that another tool might also define.

## Offline (installable PWA)

The site installs and runs with no network. `src/sw.ts` is transpiled and
emitted as `/sw.js` by the `pwa()` plugin in `vite.config.ts`, which inlines
the precache list built by `scripts/sw-manifest.ts`.

- **The shell is precached; tools are cached when first opened.** The list
  follows the entry chunk's *static* import graph only, so anything that leaks
  into the eager graph is downloaded by every visitor on first paint — a second
  reason the laziness rule matters.
- **Don't precache the heavy assets.** The jq wasm (929 KB), pdf.js worker
  (1.3 MB) and sql.js wasm (658 KB) are runtime-cached on first use. All of
  them are invisible to `dist/.vite/manifest.json`, which is why the list is
  built from the Rollup bundle instead.
- **The icon font is a subset, and precached.** Every page draws icons, so
  `src/shell/MaterialSymbolsOutlined.woff2` holds only the ~160 ligatures the
  source uses (~25 KB, axes pinned to `wght 400 / FILL 0 / GRAD 0`, `opsz`
  kept) and rides in with the shell as an `importedAssets` entry of the entry
  chunk's CSS. The full 3.9 MB font lives in `scripts/fonts/`, which is never
  emitted. **Using an icon not yet in the subset fails `src/shell/icons.test.ts`**
  (otherwise the browser just prints its name as a word): run
  `npm run icon-font` and commit `scripts/fonts/` and the font. The names are
  found by `scripts/icon-names.ts`: every Material Symbols ligature written as
  a string literal or lone JSX word in a src file that renders the class or
  mentions "icon" — so tables, ternaries and `{t.icon}` all count, but a name
  assembled at runtime (`'arrow_' + side`) would not. `check-bundle.mjs` fails
  if the font is not precached or exceeds 64 KiB. `font-display: block` stays:
  with a precached 25 KB font the block period is negligible, and `swap` would
  flash the names as words.
- **So is the display face.** `src/shell/InterTight-display.woff2` (~16 KB,
  Inter Tight, OFL — licence in `scripts/fonts/inter-tight/`) holds weights
  600–900 and printable ASCII only; it rides in with the shell like the icon
  font. `check-bundle.mjs` fails if it is not precached or exceeds 32 KiB.
- `src/shell/pwa.ts` registers the worker and renders the update prompt; it is
  imported lazily from `main.tsx` to stay out of the entry chunk, and is plain
  DOM rather than React for the same reason. Dev never registers a worker.
- A new build prompts to reload rather than swapping itself in. `sw.js` must
  differ byte-wise per deploy or no browser sees the update, so the version
  hash covers the icons and `index.html`, not just hashed asset names.
- A tool never opened online fails to load offline; `ErrorBoundary` says so
  instead of reporting a crash.

## Commands

- `npm run dev` — dev server (SPA fallback covers deep links like /jq)
- `npm test` — Vitest; includes integration suites that run the real jq wasm
- `npm run build` — tsc + vite build + 404.html copy (GitHub Pages fallback)
  + `check-bundle.mjs` (entry budget, one lazy chunk per registry slug, sw.js
  precache sanity)
- `npm run icon-font` — rebuild the subset icon font from
  `scripts/fonts/MaterialSymbolsOutlined-full.woff2` (one-shot; commit the
  output). Needs Node >= 22.18 and Python 3 with `pip install fonttools brotli`
  (`PYTHON=/path/to/venv/python` to pick the interpreter)
- `npm run display-font` — rebuild the display font subset from
  `scripts/fonts/inter-tight/` (one-shot; commit the output; same fontTools
  prerequisite)
- `npm run icons` — regenerate `public/icons/*.png` from the site mark
  (one-shot; commit the output — the build does not run it)

## Existing tools

- `tools/jq/` — jq playground: real jq 1.8.2 wasm in workers, CodeMirror
  editor with input-aware autocomplete, state shared as `#z=` (gzipped) in the
  URL fragment. Engine quirks are in README.md's "jq engine notes" (argv ~1 MB
  crash guard, `$ARGS` emulation, `--args` unusable in-wasm).
- `tools/jwt/` — JWT decode/verify/sign via WebCrypto (HS/RS/PS/ES/EdDSA).
- `tools/ssl/` — `x509.ts` is a hand-written DER/X.509 parser; chain signatures
  (RSA, ECDSA, Ed25519) are verified with WebCrypto against certificates the
  user supplies — nothing is fetched.
- `tools/regex/` — JavaScript regex match/replace. Every evaluation — matches
  and the Tests tab's cases, each with its own runner and worker — runs in
  `regex.worker.ts` via `runner.ts`, which terminates the worker after
  `REGEX_TIMEOUT_MS` and spawns a fresh one, so catastrophic backtracking costs
  an error message, not a frozen tab. Nothing user-supplied runs on the main
  thread. `syntax/parser.ts` is a hand-written ES2025 parser (Annex B, modifiers,
  duplicate named groups, v-flag class sets); its validity is fuzzed against
  the engine in `parser.test.ts`, so keep that test green when touching it —
  only `\p{…}` names are looked up by compiling `\p{Name}` alone. It feeds the
  Explain tab (`explain.ts`), the nested-quantifier / overlapping-alternative
  warning (`redos.ts`), and group names for results. The subject is a lazy
  CodeMirror chunk (`editor/`) that decorates only the visible range;
  `highlight.ts` keeps UTF-16 indices (CodeMirror's unit too) and widens
  ranges that split a surrogate pair without u/v. Share links are
  `#r=<base64url(deflate-raw(json))>` (`share.ts`, same approach as redact):
  pattern, flags, operation and replacement always; subject and test cases
  only when ticked; inflation is capped. `copyjs.ts` writes literal and
  constructor forms. `pcre2/` holds a scripted PCRE2 wasm build that is
  **not** wired in yet (see its README).
- `tools/redact/` — masks text with a block character. Segments by grapheme
  (`Intl.Segmenter`), so a family emoji is one block rather than seven, and
  reports what each space setting still leaks (word lengths above all).
  Schemes share as `#p=<base64url(deflate-raw(json))>` in the fragment, like
  jq's `#z=`: patterns travel, hand-picked literals do not unless the sharer
  opts in (they are the very values that were redacted), and the text never
  does. `lib/share.ts` normalises anything arriving from a link.
- `tools/codec/` — Base64, URL, HTML-entity and UTF-8 hex encode/decode
  (`codec.ts`).
- `tools/diff/` — line diff with hand-written linear-space Myers
  (`myers.ts`, tested minimal against a brute-force LCS). Runs in
  `diff.worker.ts` behind `runner.ts`'s deadline (O(ND) blows up on large,
  unrelated inputs). JSON mode re-prints both sides with sorted keys; big
  integers keep their digits via JSON.parse source text. `patch.ts` writes
  `diff -u` output, including `\ No newline at end of file`.
- `tools/time/` — Unix timestamps from seconds to nanoseconds, held as
  `bigint` nanoseconds so precision survives; local, UTC and any IANA zone.
- `tools/cron/` — five-field cron explainer, no library: `parse.ts` (Vixie
  semantics — day-of-month/day-of-week OR only when neither field starts
  with `*`), `describe.ts` (English), `next.ts` (wall-clock search in an IANA
  zone via `Intl.DateTimeFormat`; spring-forward gap times are skipped,
  fall-back repeats run once at the first occurrence; a 400-year search bound
  turns `0 0 30 2 *` into "never runs").
- `tools/dates/` — meeting planner and date math, no library. `zone.ts` does
  wall-clock ⇄ instant in IANA zones with `Intl.DateTimeFormat` only
  (`resolveWall`: Temporal-style 'compatible' — gap times move forward,
  repeated times take the earlier occurrence). `timeline.ts`: the planner
  covers the reference (first) zone's calendar day in 15-minute slots
  (every offset in use is a multiple of 15 min), so a 23/25-hour DST day
  has 92/100 slots and other zones' rows line up on the same instants. `catalog.ts` adds city aliases,
  current names for renamed ids (engines may list `Asia/Calcutta`) and
  abbreviations, each with all its meanings (IST, CST, BST… are flagged
  ambiguous). `duration.ts`: ISO 8601 parse/format, add (years/months with
  month-end clamping, then days on the wall clock, then exact time) with an
  exact (D = 24 h) alternative, calendar difference in the start zone,
  business days (Mon–Fri, start date excluded). `ics.ts` writes RFC 5545 by
  hand (UTC times, 75-octet folding). Fragment: `#zones=…` / `#d=…`; the
  event title is never put in it.
- `tools/pdf/` — PDF Buddy: `pdf-lib` writes, `pdfjs-dist` reads/renders
  (`lib/pdfjs.ts` loads it lazily and points it at its runtime-cached worker).
  13 sub-tools under `tools/`, each a lazy chunk.
- `tools/image/` — batch convert/resize/compress. One engine
  (`useImagePipeline`) behind four screens; canvas work runs in
  `image.worker.ts`. `gif/` is a hand-written GIF89a encoder (median cut,
  Floyd–Steinberg, LZW) because browsers cannot encode GIF — it is
  dynamically imported so it only loads when GIF output is picked, and its
  tests decode what it writes. SVG is input-only and rasterises on the main
  thread (Chrome's `createImageBitmap` rejects SVG blobs).
- `tools/qr/` — QR generator: `uqr` encodes, our own `render.ts` draws (one
  path string feeds both SVG and canvas via `Path2D`). Scan check decodes the
  render with `BarcodeDetector` where the browser has one. Only style settings
  are persisted — never content (Wi-Fi passwords). The Scan tab (`#scan`,
  `scan/`) is a lazy chunk. `scan.worker.ts` runs ZXing-C++ (`zxing-wasm`,
  every code in the image) and, only when it finds nothing, OpenCV's WeChat
  CNN decoder (`qr-scanner-wechat`, ~2.5 MB gz, dynamically imported),
  retried on 1024 and 512 px copies because its detector is scale-sensitive
  (`WECHAT_RETRY_EDGES`). Between ZXing and WeChat comes the browser's
  `BarcodeDetector`, on the main thread under a deadline, where one exists
  (Chrome on Android uses Google's barcode model, Chrome on Mac Apple
  Vision) — it saves the WeChat download there. It reports no version or
  ECC level, and Node tests cannot run it, so `readCodes` skips it.
  Both wasm payloads are served from the site — `prepareZXingModule`'s
  `locateFile` override is what stops zxing-wasm fetching from a CDN, and
  `qr-scanner-wechat/wasm` is a vite.config alias to the package's raw
  OpenCV module (its exports map only offers a first-code wrapper). On
  BoofCV's 1,232-code photo benchmark the pair reads 82.5% (jsQR read 10%).
  `regression.test.ts` guards that: eight real benchmark photos in
  `scan/fixtures/` (credited in its README; expected payloads and labelled
  corners in `manifest.json`) plus synthetic hard shots from `synth.ts`,
  each one step inside the severity where the decoders give up — two of
  them only the WeChat fallback reads; two photos only its retries read.
  The preview draws picture and outlines in one SVG `viewBox` so they
  cannot drift apart. `scan/parse.ts` reads payloads back into fields (the
  inverse of `payload.ts`, tested as a round trip); `toForm` fills the
  generator's form from a scanned code (Edit in generator, keeping its ECC
  level) and says when the form can't rebuild it byte for byte, offering
  Edit as text instead. Links only open on a
  click and show the punycode host first.
- `tools/exif/` — photo metadata viewer/stripper, hand-written (no exifr):
  `lib/exif.ts` is a bounds-checked TIFF reader (visited-offset set against
  IFD loops, capped chains and entry counts); one module per container
  (`jpeg`, `png`, `webp`, `gif`, `heif`) parses blocks and strips by copying
  every non-metadata byte range — nothing is re-encoded. HEIF/AVIF Exif/XMP
  items are zero-filled in place so `iloc` offsets stay valid. Each format
  also names its image-data ranges; `processImage` SHA-256s them before and
  after and re-parses the output, and the UI's "N found → M remain" comes from
  that re-parse, never the stripper's own list. Work runs in `exif.worker.ts`
  behind `runner.ts` (a queue plus the regex-style kill-on-deadline).
  `lib/testkit.ts` builds the synthetic fixtures for every format.
- `tools/markdown/` — marked → one HTML string → a sandboxed `srcdoc` frame
  with **no `allow-scripts`** (pasted `<script>`/`onerror` stay inert, so no
  sanitizer). The frame is the preview, the print source (PDF = the browser's
  print dialog) and, via `buildHtml`, the export — one stylesheet from
  `doc/docTheme.ts` for all three. KaTeX and mermaid are `import()`-only
  (guarded by `lazy.test.ts`) and run in the parent, injecting markup. The
  frame pins `<base href="about:srcdoc">` or `#anchors` navigate it away.
  Remote images are blocked in preview/PDF by the site CSP; the exported file
  carries its own script-free CSP that allows them.
- `tools/csv/` — hand-written RFC 4180 parser that reports ragged rows and
  unterminated quotes rather than dropping them; `decode.ts` guesses UTF-8 /
  UTF-16 / Windows-1252 and shows the guess; `virtual.ts` windows the grid in
  both axes for very large files. "Query with SQL" re-serialises every row
  (edits included, filters/sort ignored) as comma CSV and `sendTo('sqlite')`s
  it, with the header choice as RFC 4180's `header=present|absent` MIME
  parameter.
- `tools/html-table/` — parses pasted HTML with `DOMParser` (inert: no scripts
  run, nothing touches the live document), expands colspan/rowspan into a
  grid, exports CSV, TSV, JSON or Markdown.
- `tools/sqlite/` — SQLite viewer on `sql.js` (pinned; its wasm is a `?url`
  asset passed via `locateFile`, loaded inside `sqlite.worker.ts` only, so it
  is runtime-cached, never precached). `runner.ts` copies the regex runner's
  deadline pattern: requests are queued, each has a deadline
  (`QUERY_TIMEOUT_MS`), and a timed-out worker is terminated and the next call
  reopens the *original* bytes the runner keeps — edits are lost and the UI
  says so. `engine.ts` is plain functions over a `Database` (tested against
  the real wasm in Node); statements keep at most `ROW_CAP` rows. Identifiers
  are always double-quoted (`quoteIdent`); schema columns come from
  `pragma_table_xinfo(?)` with a bound name. `sqljs.d.ts` declares the API
  instead of `@types/sql.js`, which would drag `@types/node` into the app.
  `importer.ts` turns CSV/TSV/JSON/JSONL into tables (copies of the CSV
  tool's `parse.ts`/`decode.ts` live here as `csvparse.ts`/`decode.ts`): a
  column is INTEGER/REAL only if every value reads back as that number;
  leading zeros, integers past 2^53 (JSON too, via reviver source +
  `JSON.rawJSON` where the engine has them) and ISO dates stay TEXT with a
  note; nested JSON is stored as JSON text; ragged rows are padded/widened
  and counted. The worker's `analyze` plans a file, `import` runs all files
  in one SAVEPOINT with prepared inserts in ~100 ms slices, posting progress
  and yielding a macrotask so a `cancel` message can get in — cancel or any
  error rolls the batch back. Imports are exempt from `QUERY_TIMEOUT_MS`:
  the runner restarts their deadline on every progress report
  (`IMPORT_STALL_MS`). `/sqlite` takes a `takeHandoff('sqlite')` payload on
  mount and offers it as an import into a new in-memory database.
- `tools/hash/` — SHA-1/256/384/512 digests and HMACs via WebCrypto only
  (no MD5: `crypto.subtle` lacks it, so don't advertise it). Files are read
  whole with `File.arrayBuffer` — no streaming. Compare (`compareDigest`)
  ignores whitespace, matches hex case-insensitively and accepts Base64 or
  Base64URL, padded or not.
- `tools/uuid/` — UUID/ULID generator and inspector, hand-written (no
  libraries). `uuid.ts` parses every common UUID spelling, reads RFC 9562
  version/variant, v1/v6 timestamps (bigint 100-ns ticks, 7 fractional
  digits), clock sequence and node (multicast bit = random node), v7 ms, and
  generates v4 and v7 (monotonic random, §6.2 method 2). `ulid.ts` is Crockford
  base32 with I/L→1, O→0 and a monotonic generator. Randomness is only
  `crypto.getRandomValues`; tests hold the RFC 9562 Appendix A vectors.
- `tools/convert/` — YAML ⇄ JSON ⇄ TOML. `yaml` (YAML 1.2, merge keys on)
  and `smol-toml` (TOML 1.0) are imported only here; JSON uses our own strict
  parser (`parseJson`) for exact big integers, duplicate-key errors and
  stable line/column. One value model: `bigint` = integer, `number` = float,
  so `1.0` and `2^53 + 1` survive. Everything the trip loses is a `Note`:
  TOML null keys are dropped and listed (null inside an array is refused —
  dropping it would shift indices), anchors/merge keys are expanded,
  comments and tags are not kept, TOML dates become strings, YAML 1.1
  readings (`no`, `0755`, `1:20`) are hinted and quoted on output.
- `tools/otp/` — TOTP & HOTP. HMAC is WebCrypto only (`otp.ts`; tests hold
  RFC 4226 Appendix D and RFC 6238 Appendix B). `base32.ts` forgives case,
  spaces and padding; `uri.ts` parses and builds otpauth:// URIs;
  `migration.ts` is a hand-written protobuf reader for Google
  Authenticator's `otpauth-migration://` payload (schema in its header;
  no period field, so exports are 30 s). QR images go through ZXing-C++ in
  `scan/scan.worker.ts` (same `locateFile` override as the QR tool, copied —
  not imported) under a deadline; re-import QR codes are drawn from `uqr`'s
  matrix as one SVG path. Secrets are hidden until revealed and nothing is
  persisted — no storage, no URL fragment.
- `tools/curl/` — cURL converter. `tokenize.ts` is a hand-written, linear
  word splitter for bash (quotes, `$'…'` with UTF-8 byte escapes read as
  Latin-1 when invalid, backslash-newline) and Windows cmd (caret layer, then
  argv; backslash pairs read the way Chrome/Firefox's escapeStringWin wrote
  them). Shell constructs are notes, never run. `parse.ts` applies curl's
  rules (method inference, -d joining, -H precedence over -A/-e/-b/-u) and
  records each value's token + offset, which `secrets.ts` uses to rewrite
  only the words holding a secret, re-quoted for the same shell. Generators
  (`generate.ts`) keep bodies byte-exact (`exactJsonValue` gates JSON
  literals). Nothing executes the request (and connect-src would block any
  other origin).

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

**A tool is one folder plus one registry line** (plus a README row). To add one:

1. Create `src/tools/<slug>/index.tsx` default-exporting the tool component.
   Put ALL of its code there: components, helpers, workers, styles
   (`import './<slug>.css'`), tests (`*.test.ts`).
2. Add one entry to `src/shell/registry.ts` (`slug`, `name`, `tagline`, `mark`,
   `category`, and a `load: () => import(...)` thunk). That dynamic import is
   what makes the tool a lazy chunk. `category` must be one of the ids in
   `categories` in `src/shell/Landing.tsx`.
3. Add a row to the tool table in `README.md` — `| <name> | [/<slug>](https://theswissknife.com/<slug>) | … |`,
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
    GitHub, theme toggle). Pass `brand`, optional `localLabel`, optional
    `beforeSwitcher` (tabs, badges) and `children` (action buttons after the
    spacer).
  - `useToast.ts`: `{ toast, showToast }` — 4 s toast state; render it as
    `<div className="shell-toast" role="status" aria-live="polite">`.
  - `useCopy.ts`: `useCopy(showToast)` — clipboard helper with toast feedback.

  Everything else in `shell/` (App, Landing, ToolSidebar, CommandPalette,
  palette, sidebar, BladeMark, ErrorBoundary, pwa) is shell-internal; App
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
  the entry chunk plus its static imports is ~66 KiB gz (react + shell)
  against a 68 KiB budget.
  Adding a tool should move it by ~0.1 KiB (its registry line); a jump of
  kilobytes means the tool leaked into the eager graph.
- **Sub-tools within a tool must also be lazy** when there are many (PDF
  Buddy's 13 sub-tools are each a `lazy()` chunk), and so must heavy optional
  paths (image's GIF encoder, pdf.js).
- **Untrusted work goes in a worker with a deadline** when it can hang: jq runs
  in workers that are reloaded after a crash; regex runs in a worker that is
  terminated on timeout (`tools/regex/runner.ts`).
- Use the CSS variables from `src/shell/theme.css` (both themes come free);
  prefix tool class names with the slug (`.jwt-…`) to avoid collisions —
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
- **Don't precache the heavy assets.** The icon font (3.9 MB), jq wasm (929 KB)
  and pdf.js worker (1.3 MB) are runtime-cached on first use. All three are
  invisible to `dist/.vite/manifest.json`, which is why the list is built from
  the Rollup bundle instead.
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
- `tools/regex/` — JavaScript regex match/replace. Every evaluation runs in
  `regex.worker.ts` via `runner.ts`, which terminates the worker after
  `REGEX_TIMEOUT_MS` and spawns a fresh one, so catastrophic backtracking costs
  an error message, not a frozen tab. `pcre2/` holds a scripted PCRE2 wasm
  build that is **not** wired in yet (see its README).
- `tools/redact/` — masks text with a block character. Segments by grapheme
  (`Intl.Segmenter`), so a family emoji is one block rather than seven, and
  reports what each space setting still leaks (word lengths above all).
  Schemes share as `#p=<base64url(deflate-raw(json))>` in the fragment, like
  jq's `#z=`: patterns travel, hand-picked literals do not unless the sharer
  opts in (they are the very values that were redacted), and the text never
  does. `lib/share.ts` normalises anything arriving from a link.
- `tools/codec/` — Base64, URL, HTML-entity and UTF-8 hex encode/decode
  (`codec.ts`).
- `tools/time/` — Unix timestamps from seconds to nanoseconds, held as
  `bigint` nanoseconds so precision survives; local, UTC and any IANA zone.
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
  CNN decoder (`qr-scanner-wechat`, ~2.5 MB gz, dynamically imported).
  Both wasm payloads are served from the site — `prepareZXingModule`'s
  `locateFile` override is what stops zxing-wasm fetching from a CDN, and
  `qr-scanner-wechat/wasm` is a vite.config alias to the package's raw
  OpenCV module (its exports map only offers a first-code wrapper). On
  BoofCV's 1,232-code photo benchmark the pair reads 82% (jsQR read 10%).
  `regression.test.ts` guards that: six real benchmark photos in
  `scan/fixtures/` (credited in its README; expected payloads and labelled
  corners in `manifest.json`) plus synthetic hard shots from `synth.ts`,
  each one step inside the severity where the decoders give up — two of
  them only the WeChat fallback reads.
  **Camera-free by design**: the scanner reads images only (file, drop,
  paste) and never calls `getUserMedia` — don't add live camera scanning.
  The preview draws picture and outlines in one SVG `viewBox` so they
  cannot drift apart. `scan/parse.ts` reads payloads back into fields (the
  inverse of `payload.ts`, tested as a round trip). Links only open on a
  click and show the punycode host first.
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
  both axes for very large files.
- `tools/html-table/` — parses pasted HTML with `DOMParser` (inert: no scripts
  run, nothing touches the live document), expands colspan/rowspan into a
  grid, exports CSV, TSV, JSON or Markdown.

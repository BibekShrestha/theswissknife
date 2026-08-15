# The Swiss Knife

Multi-tool developer site (theswissknife.com): a landing page plus dedicated,
fully client-side tools under path routes (`/jq`, `/jwt`, …). Vite + React 19 +
TypeScript, deployed to GitHub Pages by `.github/workflows/deploy.yml`
(tests gate every deploy).

## Architecture — read this before changing anything

```
src/
  main.tsx          bootstrap
  sw.ts             service worker — self-contained, emitted as /sw.js
  shell/            router, registry, landing, theme — SMALL and STABLE
  tools/<slug>/     ONE FOLDER PER TOOL — everything the tool needs
```

**A tool is one folder plus one registry line.** To add a tool:

1. Create `src/tools/<slug>/index.tsx` default-exporting the tool component.
   Put ALL of its code there: components, helpers, workers, styles
   (`import './<slug>.css'`), tests (`*.test.ts`).
2. Add one entry to `src/shell/registry.ts` with a `load: () => import(...)`
   thunk. That dynamic import is what makes the tool a lazy chunk.

## Hard rules

- **Never import from another tool's folder.** Tools may import ONLY from
  their own folder and `src/shell/`. Available shell exports:
  - `router.ts`: `Link`/`navigate`/`usePath`
  - `theme.ts`: `useTheme`
  - `ToolHeader.tsx`: Shared toolbar (home link, brand, tool-switcher, theme
    toggle, tool-specific children via slots)
  - `useToast.ts`: `{ toast, showToast }` — persistent toast state + 4s timer
  - `useCopy.ts`: `useCopy(showToast)` — clipboard helper with toast feedback
  - `ErrorBoundary.tsx`: Catches tool render errors (wraps every lazy tool)
- **Keep the shell tiny.** New shared additions must be generic UI patterns
  (toast, toolbar, copy) — never tool-specific logic.
- **Everything runs client-side.** No network calls with user data, ever —
  the site's promise is "nothing you paste leaves your machine".
- **Tools must stay lazy.** Nothing outside `shell/` may be imported by
  `main.tsx`/landing; check `npm run build` output — the main bundle is
  ~62KB gz (react + shell) and must not grow when you add a tool.
- **Sub-tools within a single tool must also be lazy** if there are many
  (see PDF tool's 13 subtools — each is a `lazy()` chunk).
- Tool UI headers use the `<ToolHeader>` shell component. Pass brand, optional
  `localLabel`, optional `beforeSwitcher` (tabs, badges), and `children`
  (action buttons after the spacer).
- Use the CSS variables from `src/shell/theme.css` (both themes come free);
  prefix tool class names with the slug (`.jwt-…`) to avoid collisions.

## Offline (installable PWA)

`src/sw.ts` is transpiled and emitted as `/sw.js` by the `pwa()` plugin in
`vite.config.ts`, with the precache list from `scripts/sw-manifest.ts` inlined.

- **Shell precached, tools cached on first open.** The list follows the entry
  chunk's *static* import graph, so anything that leaks into the eager graph is
  now downloaded by every visitor on first paint — a second reason the laziness
  rule above matters.
- The icon font (3.9 MB), jq wasm (929 KB) and pdf.js worker (1.3 MB) are
  runtime-cached, never precached. All three are missing from
  `dist/.vite/manifest.json`, which is why the list is built from the Rollup
  bundle instead.
- `src/shell/pwa.ts` registers the worker and renders the update prompt; it is
  imported lazily from `main.tsx` to stay out of the entry chunk, and is plain
  DOM rather than React for the same reason. Dev registers no worker.
- `sw.js` must differ byte-wise per deploy or no browser sees the update, so the
  version hash covers the icons and `index.html`, not just hashed asset names.

## Commands

- `npm run dev` — dev server (SPA fallback covers deep links like /jq)
- `npm test` — Vitest; includes integration suites that run the real jq wasm
- `npm run build` — tsc + vite build + 404.html copy (GitHub Pages fallback)
- `npm run icons` — regenerate `public/icons/*.png` from the site mark (one-shot;
  commit the output — the build does not run it)

## Existing tools

- `tools/jq/` — jq playground: real jq 1.8.2 wasm in workers, CodeMirror
  editor with input-aware autocomplete. Quirks are documented in README.md
  (argv ~1MB crash guard, $ARGS emulation, --args unusable in-wasm).
- `tools/jwt/` — JWT decode/verify/sign via WebCrypto.
- `tools/redact/` — masks text with a block character. Segments by grapheme
  (`Intl.Segmenter`), so a family emoji is one block rather than seven, and
  reports what each space setting still leaks (word lengths above all).
  Schemes share as `#p=<base64url(deflate-raw(json))>` in the fragment, like
  jq's `#z=`: patterns travel, hand-picked literals do not unless the sharer
  opts in (they are the very values that were redacted), and the text never
  does. `lib/share.ts` normalises anything arriving from a link.
- `tools/image/` — batch convert/resize/compress. One engine
  (`useImagePipeline`) behind four screens; canvas work runs in
  `image.worker.ts`. `gif/` is a hand-written GIF89a encoder (median cut,
  Floyd–Steinberg, LZW) because browsers cannot encode GIF — it is
  dynamically imported so it only loads when GIF output is picked, and its
  tests decode what it writes. SVG is input-only and rasterises on the main
  thread (Chrome's `createImageBitmap` rejects SVG blobs).

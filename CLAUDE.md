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
  their own folder and `src/shell/` (`router.ts`: `Link`/`navigate`/`usePath`;
  `theme.ts`: `useTheme`). Small helpers (toast, JSON colorizer) are
  intentionally duplicated per tool — that keeps each folder self-contained
  so an agent can work on one tool with small context.
- **Keep the shell tiny.** Don't grow it with tool-specific logic or a shared
  component library.
- **Everything runs client-side.** No network calls with user data, ever —
  the site's promise is "nothing you paste leaves your machine".
- **Tools must stay lazy.** Nothing outside `shell/` may be imported by
  `main.tsx`/landing; check `npm run build` output — the main bundle is
  ~62KB gz (react + shell) and must not grow when you add a tool.
- Tool UI headers start with the `✚` home `Link` (see existing tools).
- Use the CSS variables from `src/shell/theme.css` (both themes come free);
  prefix tool class names with the slug (`.jwt-…`) to avoid collisions.

## Offline (installable PWA)

The site installs and runs with no network. `src/sw.ts` is transpiled and
emitted as `/sw.js` by the `pwa()` plugin in `vite.config.ts`, which inlines
the precache list built by `scripts/sw-manifest.ts`.

- **The shell is precached; tools are cached when first opened.** The precache
  list follows the entry chunk's *static* import graph only. This is a second
  reason the laziness rule above matters: anything that leaks into the eager
  graph is downloaded by every visitor on first paint, not just bundled.
- **Don't precache the heavy assets.** The icon font (3.9 MB), jq wasm (929 KB)
  and pdf.js worker (1.3 MB) are runtime-cached on first use, and they are all
  invisible to `dist/.vite/manifest.json` — the list is built from the Rollup
  bundle for exactly that reason.
- Registration lives in `src/shell/pwa.ts`, imported lazily from `main.tsx` so
  it stays out of the entry chunk. Dev never registers a worker.
- A new build prompts to reload rather than swapping itself in; `sw.js` must
  differ byte-wise per deploy or the browser never notices the update, which is
  why the version hash covers the icons and `index.html` too.

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
- `tools/redact/` — grapheme-aware text masking with block characters, and an
  honest note on what each setting still reveals.
- `tools/image/` — batch convert/resize/compress with a hand-written GIF
  encoder (`gif/`, lazily imported) since browsers cannot encode GIF. See
  AGENTS.md for the details worth knowing before touching it.

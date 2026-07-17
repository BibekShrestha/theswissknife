# jq playground

**Live: <https://bibekshrestha.github.io/jq-playground/>**

A web frontend for [jq](https://jqlang.org) with full feature support — the **real jq 1.8.2
binary compiled to WebAssembly** runs entirely in your browser. No backend, no data leaves
your machine.

## Run it

```sh
npm install
npm run dev      # dev server
npm test         # unit + integration tests (runs the real wasm jq)
npm run build    # production build → dist/
npm run preview  # serve the production build
```

## Features

- **Real jq, all of it** — every builtin, regex, streaming, dates, `input`/`inputs`,
  multi-document input, `$ENV`, exit codes, stderr. It's the actual jq binary
  ([jq-wasm](https://www.npmjs.com/package/jq-wasm)), not a reimplementation.
- **Full flag surface** — toggles for `-n -R -s -r -j -c -S -a -e --tab --indent --seq --stream`,
  named `--arg` / `--argjson` variables, positional `$ARGS.positional` values, plus a free-form
  extra-flags field for anything else (e.g. `--raw-output0`).
- **Safe to experiment** — jq runs in a Web Worker with a configurable watchdog (5/15/60s);
  infinite loops get terminated and the worker respawns. A Stop button appears while a run
  is in flight. Oversized argument values (which crash the wasm) are caught with a helpful
  error, and a crashed engine reloads automatically.
- **Errors don't eat your output** — when the current filter fails (as it constantly does
  mid-edit), the last successful output stays visible, dimmed and marked *stale*, with the
  error shown persistently alongside.
- Auto-run as you type (toggleable), ⌘⏎ / Ctrl+⏎ to run manually.
- **Smart filter editor** (CodeMirror, lazy-loaded) — jq syntax highlighting, bracket
  matching, and autocomplete: builtins pulled from the engine itself, `$variables` in
  scope, `@formats`, cheatsheet snippets, and **field names mined from your actual
  input** (`.repos[].` suggests the keys that exist there). Compile errors are
  underlined at the exact spot jq reports.
- Syntax-highlighted output, stderr panel, exit-code + timing badges.
- 12 loadable examples and a click-to-insert jq reference drawer.
- Share button — filter + input + options, gzip-compressed into the URL fragment.
- Copy command — emits the equivalent `jq …` shell command with correct quoting.
- Input tools: format / minify / open local file / copy / clear; output copy / download.
- Dark & light themes; state persists in localStorage.

## Implementation notes

- `src/jq.worker.ts` runs jq off the main thread; `src/useJq.ts` manages the worker with
  latest-wins queueing and terminate-and-respawn on timeout/stop.
- **Positional args are emulated.** The wasm wrapper's argv is `[...flags, query, /dev/stdin]`,
  so real `--args`/`--jsonargs` would swallow the query and stdin. Instead the app passes the
  values via `--argjson` and rebinds `$ARGS` around the user's filter
  (`($ARGS | .positional = $v | …) as $ARGS | (filter)`) — behaviour matches the CLI exactly.
  The "Copy command" feature emits real `--args`/`--jsonargs` for terminal use.
- File-based flags (`--slurpfile`, `--rawfile`, `-f`, `-L` modules) have no filesystem in the
  browser; use `--argjson`/`--arg` variables instead.
- `leaf_paths` was removed in jq 1.8 — use `paths(scalars)`.
- A single argv token near 1 MB crashes the wasm (emscripten stack limit), and a crashed
  instance stays broken. The app guards values at 512 KB and reloads the engine after any
  crash. Large data belongs in the input pane (stdin), which has no such limit.
- Tests (`src/*.test.ts`) gate the Pages deploy; the integration suite runs every example
  and cheatsheet snippet through the actual wasm jq so engine upgrades can't silently
  break them.

## License

MIT — see [LICENSE](LICENSE).

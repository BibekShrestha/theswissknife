# jq playground

A web frontend for [jq](https://jqlang.org) with full feature support — the **real jq 1.8.2
binary compiled to WebAssembly** runs entirely in your browser. No backend, no data leaves
your machine.

## Run it

```sh
npm install
npm run dev      # dev server
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
- **Safe to experiment** — jq runs in a Web Worker with a 15s watchdog; infinite loops get
  terminated and the worker respawns. A Stop button appears while a run is in flight.
- Auto-run as you type (toggleable), ⌘⏎ / Ctrl+⏎ to run manually.
- Syntax-highlighted output, stderr panel, exit-code + timing badges.
- 12 loadable examples and a click-to-insert jq reference drawer.
- Share button — encodes filter + input + options into a URL.
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

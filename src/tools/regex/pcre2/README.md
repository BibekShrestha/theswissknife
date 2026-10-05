# PCRE2 browser build (not wired in yet)

Status: the Regex lab ships only the JavaScript engine today. This folder holds
the scripted build for a second engine; its output is **not** committed and
nothing imports it.

`./build.sh` compiles official PCRE2 10.47 (commit
`f454e231fe5006dd7ff8f4693fd2b8eb94333429`) with the pinned
`emscripten/emsdk:6.0.3` image into `pcre2.wasm` and `pcre2-glue.js` here. The
build enables the 16-bit Unicode library and disables JIT.

To ship it: commit the two artifacts plus PCRE2's `LICENCE` as
`PCRE2-LICENSE.md`, lazy-load the glue inside `regex.worker.ts` (the runner's
timeout already guards it), bring back an engine selector, and only then put
PCRE2 back in the registry tagline and README row.

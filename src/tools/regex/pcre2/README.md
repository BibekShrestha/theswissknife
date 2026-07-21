# PCRE2 browser build

`pcre2.wasm` and `pcre2-glue.js` are generated from official PCRE2 10.47 commit
`f454e231fe5006dd7ff8f4693fd2b8eb94333429` with the pinned
`emscripten/emsdk:6.0.3` image. Run `./build.sh` from this directory to reproduce
the artifacts. The build enables the 16-bit Unicode library and disables JIT.

The upstream license is preserved in `PCRE2-LICENSE.md`.

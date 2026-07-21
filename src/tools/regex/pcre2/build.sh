#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tsk-pcre2.XXXXXX")"
SOURCE_DIR="$WORK_DIR/pcre2"

git clone https://github.com/PCRE2Project/pcre2.git "$SOURCE_DIR"
git -C "$SOURCE_DIR" checkout f454e231fe5006dd7ff8f4693fd2b8eb94333429
cp "$SCRIPT_DIR/bridge.c" "$SOURCE_DIR/bridge.c"

docker run --rm \
  -v "$SOURCE_DIR:/src" \
  -w /src \
  emscripten/emsdk:6.0.3 \
  bash -lc '
    emcmake cmake -S . -B build-wasm \
      -DPCRE2_BUILD_PCRE2_8=OFF \
      -DPCRE2_BUILD_PCRE2_16=ON \
      -DPCRE2_BUILD_PCRE2_32=OFF \
      -DPCRE2_BUILD_PCRE2GREP=OFF \
      -DPCRE2_BUILD_TESTS=OFF \
      -DPCRE2_SUPPORT_JIT=OFF \
      -DPCRE2_SUPPORT_UNICODE=ON \
      -DBUILD_SHARED_LIBS=OFF \
      -DBUILD_STATIC_LIBS=ON
    cmake --build build-wasm --target pcre2-16-static -j2
    emcc bridge.c build-wasm/libpcre2-16.a \
      -I build-wasm/interface \
      -DPCRE2_CODE_UNIT_WIDTH=16 -DPCRE2_STATIC \
      -O3 -flto \
      -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createPcre2Module \
      -sENVIRONMENT=worker -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=1 \
      -sINITIAL_MEMORY=16777216 -sMAXIMUM_MEMORY=268435456 -sMALLOC=emmalloc \
      -sEXPORTED_FUNCTIONS='"'"'["_malloc","_free","_tsk_compile","_tsk_code_free","_tsk_match_data_create","_tsk_match_data_free","_tsk_match_context_create","_tsk_match_context_free","_tsk_match","_tsk_ovector_count","_tsk_ovector_pointer","_tsk_pattern_info","_tsk_substitute","_tsk_error_message"]'"'"' \
      -o pcre2-glue.js
  '

cp "$SOURCE_DIR/pcre2-glue.js" "$SCRIPT_DIR/pcre2-glue.js"
cp "$SOURCE_DIR/pcre2-glue.wasm" "$SCRIPT_DIR/pcre2.wasm"
cp "$SOURCE_DIR/LICENCE.md" "$SCRIPT_DIR/PCRE2-LICENSE.md"
echo "Built PCRE2 10.47 with emscripten/emsdk:6.0.3"

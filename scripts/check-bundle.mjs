import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const manifest = JSON.parse(readFileSync('dist/.vite/manifest.json', 'utf8'))
const entry = manifest['index.html'] ?? manifest['src/main.tsx']

if (!entry?.file) throw new Error('Could not find the main entry in the Vite manifest.')

const bytes = gzipSync(readFileSync(`dist/${entry.file}`)).byteLength

// The entry chunk is react + the shell, and adding a tool should only add its
// registry line — about a tenth of a kilobyte of name and tagline. The budget
// is not there to police those; it is there to catch the shell growing, or a
// tool leaking into the eager graph. Sized so registry lines never trip it on
// their own, while anything chunk-shaped still does — the smallest tool chunk
// is 2.4 KiB gzipped.
const BUDGET_KIB = 68
const budget = BUDGET_KIB * 1024

if (bytes > budget) {
  throw new Error(
    `Main bundle is ${(bytes / 1024).toFixed(2)} KiB gzipped; budget is ${BUDGET_KIB} KiB. ` +
      'Something outside shell/ reached the entry chunk, or the shell itself grew.',
  )
}

// Read from src/shell/registry.ts rather than repeating the slugs: a hardcoded
// list stops guarding the moment someone adds a tool and forgets this file.
const registry = readFileSync('src/shell/registry.ts', 'utf8')
const required = [...registry.matchAll(/\bslug:\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1])

if (required.length === 0) throw new Error('Could not read any tool slugs from the registry.')

const sources = Object.keys(manifest)
for (const slug of required) {
  if (!sources.some((source) => source.includes(`/tools/${slug}/`))) {
    throw new Error(`Missing lazy build entry for /${slug} — is it imported outside its own chunk?`)
  }
}

// The service worker carries its precache list inlined, which is also what
// makes sw.js differ between deploys. A worker that still has the placeholder,
// or that never learned this build's entry chunk, would install and cache
// nothing — and would look perfectly healthy doing it.
const sw = readFileSync('dist/sw.js', 'utf8')

if (sw.includes('__SW_MANIFEST__')) {
  throw new Error('dist/sw.js still contains the __SW_MANIFEST__ placeholder.')
}
if (!sw.includes(entry.file)) {
  throw new Error(`dist/sw.js does not reference the entry chunk ${entry.file}; precache list is wrong.`)
}

console.log(
  `main bundle ${(bytes / 1024).toFixed(2)} KiB gzip (${((budget - bytes) / 1024).toFixed(2)} KiB under the ${BUDGET_KIB} KiB budget) · ${required.length} lazy tool chunks · sw.js ${(sw.length / 1024).toFixed(2)} KiB`,
)

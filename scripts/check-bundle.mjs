import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const manifest = JSON.parse(readFileSync('dist/.vite/manifest.json', 'utf8'))
const entry = manifest['index.html'] ?? manifest['src/main.tsx']

if (!entry?.file) throw new Error('Could not find the main entry in the Vite manifest.')

const bytes = gzipSync(readFileSync(`dist/${entry.file}`)).byteLength
const budget = 64 * 1024

if (bytes > budget) {
  throw new Error(`Main bundle is ${(bytes / 1024).toFixed(2)} KiB gzipped; budget is 64 KiB.`)
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

console.log(
  `main bundle ${(bytes / 1024).toFixed(2)} KiB gzip (64 KiB budget) · ${required.length} lazy tool chunks`,
)

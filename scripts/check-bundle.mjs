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

const required = ['jq', 'jwt', 'regex', 'codec', 'time']
const sources = Object.keys(manifest)
for (const slug of required) {
  if (!sources.some((source) => source.includes(`/tools/${slug}/`))) {
    throw new Error(`Missing lazy build entry for /${slug}.`)
  }
}

console.log(`main bundle ${(bytes / 1024).toFixed(2)} KiB gzip (64 KiB budget)`)

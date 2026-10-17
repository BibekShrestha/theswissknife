/**
 * `npm run icon-font` — rebuilds src/shell/MaterialSymbolsOutlined.woff2 as a
 * subset of the full Material Symbols font holding only the icons the site
 * uses (found by scripts/icon-names.ts).
 *
 * One-shot, like `npm run icons`: commit the three outputs; the build does not
 * run this.
 *   scripts/fonts/ligatures.txt  every ligature in the full font
 *   scripts/fonts/icons.json     the icons the subset was built from
 *   src/shell/MaterialSymbolsOutlined.woff2
 *
 * Prerequisites: Node >= 22.18 (runs this .ts directly) and Python 3 with
 * fontTools and brotli — `pip install fonttools brotli`. Set PYTHON to use an
 * interpreter other than `python3`, e.g. one in a virtualenv.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findIconNames, isIconSource, parseLigatures, type Source } from './icon-names.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const at = (path: string) => join(root, path)

const FULL = 'scripts/fonts/MaterialSymbolsOutlined-full.woff2'
const LIGATURES = 'scripts/fonts/ligatures.txt'
const LIST = 'scripts/fonts/icons.json'
const OUT = 'src/shell/MaterialSymbolsOutlined.woff2'

const python = process.env.PYTHON || 'python3'
const subset = (...args: string[]) =>
  execFileSync(python, ['-I', at('scripts/fonts/subset.py'), ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })

function sources(dir: string): Source[] {
  return readdirSync(at(dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .filter(isIconSource)
    .map((path) => ({ path, text: readFileSync(at(path), 'utf8') }))
}

let ligatureText: string
try {
  ligatureText = subset('ligatures', at(FULL))
} catch (error) {
  console.error(`icon-font: could not run ${python} with fontTools — pip install fonttools brotli`)
  throw error
}
writeFileSync(at(LIGATURES), ligatureText.endsWith('\n') ? ligatureText : `${ligatureText}\n`)

const names = [...findIconNames(sources('src'), parseLigatures(ligatureText)).keys()]
writeFileSync(at(LIST), `${JSON.stringify(names, null, 2)}\n`)

process.stdout.write(subset('subset', at(FULL), at(OUT), ...names))
const bytes = readFileSync(at(OUT)).length
console.log(`icon-font: ${names.length} icons, ${(bytes / 1024).toFixed(1)} KiB → ${OUT}`)

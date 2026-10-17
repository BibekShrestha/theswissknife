/**
 * Which Material Symbols the site can render — the input to the subset font
 * (`npm run icon-font`) and to the guard in src/shell/icons.test.ts that fails
 * when a new icon is used without regenerating it.
 *
 * An icon is a ligature: the text of an element with class
 * `material-symbols-outlined`. Most are literal children, but many are not —
 * `{theme === 'dark' ? 'light_mode' : 'dark_mode'}`, `{t.icon}` read from a
 * table in another file, `{statusIcon(ok)}`, a tuple destructured out of a
 * lookup map. Following those through the code is a type checker's job, so
 * this over-approximates instead: in every source file that can name an icon
 * (it renders the class, or mentions "icon" at all), every string literal or
 * lone JSX word that is also a ligature in the full font counts as used.
 * That keeps a few words that are never drawn ("csv", "start") — a few
 * hundred bytes each — and misses only names assembled at runtime
 * (`'arrow_' + side`), which the site does not do and should not start.
 *
 * Pure (sources in, names out) so the test can feed it import.meta.glob and
 * the CLI can feed it the file system, exactly as scripts/sw-manifest.ts is
 * shared between the build and its test.
 */

export interface Source {
  /** Repo-relative, forward slashes, e.g. `src/shell/Landing.tsx`. */
  path: string
  text: string
}

/** App source that can render an icon: .ts/.tsx under src/, but not tests or declarations. */
export function isIconSource(path: string): boolean {
  return /^src\/.+\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) && !/\.d\.ts$/.test(path)
}

/** A file that renders icons or carries icon names for something that does. */
const ICON_BEARING = /material-symbols-outlined|icon/i

/** Quoted words and lone JSX text words — the only shapes a ligature name takes in source. */
const CANDIDATE = /'([a-z0-9_]+)'|"([a-z0-9_]+)"|`([a-z0-9_]+)`|>\s*([a-z0-9_]+)\s*</g

/**
 * @param ligatures  Every ligature name in the full font (scripts/fonts/ligatures.txt).
 * @returns icon name → the files it was found in, sorted by name.
 */
export function findIconNames(
  sources: readonly Source[],
  ligatures: ReadonlySet<string>,
): Map<string, string[]> {
  const found = new Map<string, Set<string>>()
  for (const { path, text } of sources) {
    if (!isIconSource(path) || !ICON_BEARING.test(text)) continue
    for (const match of text.matchAll(CANDIDATE)) {
      const name = match[1] ?? match[2] ?? match[3] ?? match[4]
      if (!ligatures.has(name)) continue
      let files = found.get(name)
      if (!files) found.set(name, (files = new Set()))
      files.add(path)
    }
  }
  return new Map(
    [...found.keys()].sort().map((name) => [name, [...found.get(name)!].sort()] as const),
  )
}

/** Parses scripts/fonts/ligatures.txt. */
export function parseLigatures(text: string): Set<string> {
  return new Set(text.split('\n').map((line) => line.trim()).filter(Boolean))
}

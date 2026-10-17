import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Reads a repo file as text for tests. Vitest replaces CSS imports with an
 * empty string (even with `?raw`), so a test that checks a stylesheet's
 * source reads it from disk instead.
 */
export const readText = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8')

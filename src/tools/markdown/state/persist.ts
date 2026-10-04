import { DEFAULT_SETTINGS, MARGINS, PAPERS, THEMES, type DocSettings } from '../doc/docTheme'

/**
 * The document lives in this browser's localStorage — nowhere else — and the
 * UI says so next to "Clear". Everything read back is validated: a stale or
 * hand-edited value must fall back to a default, not break the CSS builder.
 */

export interface MdState {
  doc: string
  settings: DocSettings
  /** Editor share of the split, in percent. */
  split: number
  sync: boolean
}

export const STORAGE_KEY = 'markdown.state.v1'

const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback

const num = (value: unknown, lo: number, hi: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback

const bool = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback

export function normalizeSettings(raw: Partial<DocSettings> | undefined): DocSettings {
  const d = DEFAULT_SETTINGS
  const s = raw ?? {}
  return {
    theme: pick(s.theme, THEMES.map((t) => t.id), d.theme),
    paper: pick(s.paper, PAPERS.map((p) => p.id), d.paper),
    landscape: bool(s.landscape, d.landscape),
    margin: pick(s.margin, MARGINS.map((m) => m.id), d.margin),
    fontSize: num(s.fontSize, 10, 22, d.fontSize),
    lineHeight: num(s.lineHeight, 1.2, 2.2, d.lineHeight),
    toc: bool(s.toc, d.toc),
    tocDepth: pick(s.tocDepth, [2, 3, 4] as const, d.tocDepth),
    linkUrls: bool(s.linkUrls, d.linkUrls),
    highlight: bool(s.highlight, d.highlight),
    pageGuide: bool(s.pageGuide, d.pageGuide),
  }
}

export function loadState(sample: string, storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): MdState {
  let raw: Partial<MdState> | null = null
  try {
    raw = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null')
  } catch {
    raw = null
  }
  return {
    doc: typeof raw?.doc === 'string' ? raw.doc : sample,
    settings: normalizeSettings(raw?.settings),
    split: num(raw?.split, 20, 80, 50),
    sync: bool(raw?.sync, true),
  }
}

export function saveState(state: MdState, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Private mode or quota: the session still works, it just won't be remembered.
  }
}

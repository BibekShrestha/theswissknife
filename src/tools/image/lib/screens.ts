/**
 * The four screens. Each one is the same pipeline with a different set of
 * panels and a different starting point — issue #8 asked for conversion,
 * resizing and compression, and "all in one" is there because in practice
 * people want two of the three in a single pass.
 */

import { DEFAULT_RESIZE } from './dimensions'
import type { PipelineOptions } from '../useImagePipeline'

export type ScreenId = 'all' | 'convert' | 'resize' | 'compress'
export type PanelId = 'format' | 'resize' | 'target'

export interface ScreenMeta {
  id: ScreenId
  name: string
  tagline: string
  description: string
  icon: string
  color: string
  panels: PanelId[]
  defaults: Partial<PipelineOptions>
}

export const SCREENS: ScreenMeta[] = [
  {
    id: 'convert',
    name: 'Convert format',
    tagline: 'JPEG, PNG, WebP or GIF',
    description: 'Change one image or thirty into another format, batch download as a zip.',
    icon: 'swap_horiz',
    color: '#16a34a',
    panels: ['format'],
    defaults: { format: 'webp' },
  },
  {
    id: 'resize',
    name: 'Resize',
    tagline: 'Percentages or exact pixels',
    description: 'Scale by percentage or to exact dimensions, with the aspect ratio locked.',
    icon: 'aspect_ratio',
    color: '#2563eb',
    panels: ['resize', 'format'],
    defaults: { resize: { ...DEFAULT_RESIZE, mode: 'percent', percent: 50 } },
  },
  {
    id: 'compress',
    name: 'Compress',
    tagline: 'Quality dial or a size target',
    description: 'Squeeze the file down, or name a maximum size and let it find the settings.',
    icon: 'compress',
    color: '#d97706',
    panels: ['target', 'format'],
    defaults: { quality: 0.75, useTarget: true, targetKB: 200 },
  },
  {
    id: 'all',
    name: 'All in one',
    tagline: 'Convert, resize and compress',
    description: 'Every dial on one screen — one pass over the batch does all three.',
    icon: 'tune',
    color: '#9333ea',
    panels: ['format', 'resize', 'target'],
    defaults: {},
  },
]

export function screenById(id: ScreenId): ScreenMeta {
  const screen = SCREENS.find((candidate) => candidate.id === id)
  if (!screen) throw new Error(`Unknown screen: ${id}`)
  return screen
}

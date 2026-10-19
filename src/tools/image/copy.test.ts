import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs helper
import { readText } from '../../../scripts/read-text.mjs'

const page: string = readText('src/tools/image/index.tsx').replace(/\s+/g, ' ')

describe('metadata copy (IMG-3)', () => {
  it('does not promise that no colour profile is written — Chrome’s JPEG/WebP encoders embed sRGB', () => {
    expect(page).not.toMatch(/leaves EXIF, GPS and colour profiles behind/)
    expect(page).toMatch(/may embed a standard sRGB profile/)
  })
})

import { describe, expect, it } from 'vitest'
import { svgSize } from './svgSize'

const NS = 'xmlns="http://www.w3.org/2000/svg"'

describe('svgSize (IMG-1)', () => {
  it('does not read stroke-width as the width (Heroicons-style icon)', () => {
    const icon = `<svg ${NS} fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6"><path stroke-linecap="round" d="M4 6h16"/></svg>`
    expect(svgSize(icon)).toMatchObject({ intrinsic: { width: 1024, height: 1024 }, assumed: true })
  })

  it('treats percentages as no size: the viewBox shape at the default size, flagged as assumed', () => {
    const r = svgSize(`<svg ${NS} width="100%" height="100%" viewBox="0 0 2000 1000"></svg>`)
    expect(r).toMatchObject({ intrinsic: { width: 1024, height: 512 }, assumed: true })
    expect(r.note).toMatch(/relative/)
  })

  it('treats em as relative too', () => {
    expect(svgSize(`<svg ${NS} width="10em" height="10em" viewBox="0 0 30 10"></svg>`)).toMatchObject({ intrinsic: { width: 1024, height: 1024 / 3 }, assumed: true })
  })

  it('converts absolute units at 96 dpi', () => {
    const cm = svgSize(`<svg ${NS} width="10cm" height="5cm"></svg>`)
    expect(cm.assumed).toBe(false)
    expect(cm.intrinsic.width).toBeCloseTo(377.95, 2)
    expect(cm.intrinsic.height).toBeCloseTo(188.98, 2)
    expect(svgSize(`<svg ${NS} width="2.5in" height="72pt"></svg>`).intrinsic).toEqual({ width: 240, height: 96 })
    expect(svgSize(`<svg ${NS} width="1pc" height="25.4mm"></svg>`).intrinsic).toEqual({ width: 16, height: 96 })
  })

  it('reads exponents and px', () => {
    expect(svgSize(`<svg ${NS} width="1e3" height="500"></svg>`)).toMatchObject({ intrinsic: { width: 1000, height: 500 }, assumed: false })
    expect(svgSize(`<svg ${NS} width="64" height="32px"></svg>`).intrinsic).toEqual({ width: 64, height: 32 })
    expect(svgSize(`<svg ${NS} width=".5E2" height='2.5e+1'></svg>`).intrinsic).toEqual({ width: 50, height: 25 })
  })

  it('takes one absolute side and the viewBox shape for the other', () => {
    expect(svgSize(`<svg ${NS} width="200" viewBox="0 0 100 50"></svg>`)).toMatchObject({ intrinsic: { width: 200, height: 100 }, assumed: false })
    expect(svgSize(`<svg ${NS} height="30" width="50%" viewBox="0,0,20,10"></svg>`)).toMatchObject({ intrinsic: { width: 60, height: 30 }, assumed: false })
  })

  it('reads only the root element, past comments, declarations and quoted >', () => {
    const svg = `<?xml version="1.0"?>\n<!-- <svg width="9" height="9"> -->\n<!DOCTYPE svg>\n<svg ${NS} data-x="a>b" width="40" height="30"><rect width="5" height="5"/></svg>`
    expect(svgSize(svg)).toMatchObject({ intrinsic: { width: 40, height: 30 }, assumed: false })
    expect(svgSize(`<svg ${NS} viewBox="0 0 10 20"><rect width="5" height="5"/></svg>`)).toMatchObject({ intrinsic: { width: 512, height: 1024 }, assumed: true })
  })
})

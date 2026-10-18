import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs helper (Vitest empties CSS imports, so read from disk)
import { readText } from '../../../scripts/read-text.mjs'
import { Generate } from './index'

/**
 * The Generate button used to share one wrapping flex row with the kind's
 * hint ("122 random bits" vs "Unix ms + monotonic random — sorts by time"),
 * so switching kinds moved the button and re-flowed the row. These pin the
 * structure that prevents it; the pixel check is a manual browser sweep.
 */

const markup = renderToStaticMarkup(createElement(Generate, { copy: async () => undefined }))
const css: string = readText('src/tools/uuid/uuid.css')
const controls = /<section class="uuid-controls"[^>]*>([\s\S]*?)<\/section>/.exec(markup)?.[1] ?? ''

const balancedDivs = (html: string) => (html.match(/<div\b/g) ?? []).length === (html.match(/<\/div>/g) ?? []).length

describe('Generate controls layout', () => {
  it('keeps the hint out of the settings and after the button', () => {
    const settings = controls.indexOf('class="uuid-settings"')
    const button = controls.indexOf('<button class="uuid-primary"')
    const hint = controls.indexOf('<p class="uuid-hint"')
    expect(settings).toBeGreaterThanOrEqual(0)
    expect(button).toBeGreaterThan(settings)
    expect(hint).toBeGreaterThan(button)
    // The settings div has closed by the time the button starts: the button
    // and the hint are grid items of the section, not of the wrapping row.
    expect(balancedDivs(controls.slice(controls.lastIndexOf('<div', settings), button))).toBe(true)
  })

  it('lays the controls out as a grid with the hint in its own row', () => {
    const rule = /\.uuid-controls \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/display: grid/)
    expect(rule).toMatch(/'hint hint'/)
    expect(css).toMatch(/\.uuid-hint \{[^}]*grid-area: hint[^}]*min-height/)
    expect(css).toMatch(/\.uuid-primary \{[^}]*grid-area: action/)
  })

  it('sizes every segment for its bold label so selection cannot rewrap the settings', () => {
    const buttons = [...controls.matchAll(/<div class="uuid-seg"[\s\S]*?<\/div>/g)].flatMap((group) => [...group[0].matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)])
    expect(buttons.length).toBe(5)
    for (const [, attrs, label] of buttons) expect(attrs).toContain(`data-label="${label}"`)
    expect(css).toMatch(/\.uuid-seg button::after \{[^}]*content: attr\(data-label\)[^}]*font-weight: 600/)
  })
})

import { describe, expect, it } from 'vitest'
import { buildIcs, escapeText, foldLine, icsUtc } from './ics'

const bytes = (s: string) => new TextEncoder().encode(s).length

describe('ics', () => {
  it('writes UTC times', () => {
    expect(icsUtc(Date.parse('2026-03-29T09:05:07.123Z'))).toBe('20260329T090507Z')
  })

  it('escapes TEXT values', () => {
    expect(escapeText('a\\b; c, d\ne\r\nf')).toBe('a\\\\b\\; c\\, d\\ne\\nf')
  })

  it('folds at 75 octets without splitting characters', () => {
    const line = `DESCRIPTION:${'x'.repeat(200)}`
    const folded = foldLine(line).split('\r\n')
    expect(folded.length).toBe(3)
    expect(folded.every((l) => bytes(l) <= 75)).toBe(true)
    expect(folded.slice(1).every((l) => l.startsWith(' '))).toBe(true)
    expect(folded.map((l, i) => (i ? l.slice(1) : l)).join('')).toBe(line)

    const emoji = `SUMMARY:${'é😀'.repeat(30)}`
    const parts = foldLine(emoji).split('\r\n')
    expect(parts.every((l) => bytes(l) <= 75)).toBe(true)
    expect(parts.map((l, i) => (i ? l.slice(1) : l)).join('')).toBe(emoji)
    expect(foldLine('SHORT:1')).toBe('SHORT:1')
  })

  it('builds a VEVENT with CRLF line endings', () => {
    const ics = buildIcs({
      uid: 'abc@theswissknife.com',
      stamp: Date.parse('2026-10-17T12:00:00Z'),
      start: Date.parse('2026-03-29T09:00:00Z'),
      end: Date.parse('2026-03-29T10:00:00Z'),
      summary: 'Sync; planning, Q2',
      description: 'London 10:00\nNew York 05:00',
    })
    expect(ics.endsWith('\r\n')).toBe(true)
    expect(ics.replace(/\r\n/g, '').includes('\n')).toBe(false)
    const lines = ics.split('\r\n')
    expect(lines).toContain('DTSTART:20260329T090000Z')
    expect(lines).toContain('DTEND:20260329T100000Z')
    expect(lines).toContain('DTSTAMP:20261017T120000Z')
    expect(lines).toContain('SUMMARY:Sync\\; planning\\, Q2')
    expect(lines).toContain('DESCRIPTION:London 10:00\\nNew York 05:00')
    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(lines.at(-2)).toBe('END:VCALENDAR')
  })
})

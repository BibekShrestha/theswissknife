import { describe, expect, it } from 'vitest'
import { baseName, formatBytes, outputName, uniqueNames } from './naming'

describe('baseName', () => {
  it('drops the extension and any directory prefix', () => {
    expect(baseName('photo.PNG')).toBe('photo')
    expect(baseName('holiday/2026/beach.jpeg')).toBe('beach')
    expect(baseName('C:\\pics\\logo.webp')).toBe('logo')
  })

  it('keeps dots inside the name', () => {
    expect(baseName('logo.v2.final.png')).toBe('logo.v2.final')
  })

  it('keeps digits, dashes and unicode', () => {
    expect(baseName('img-2026-08_05.png')).toBe('img-2026-08_05')
    expect(baseName('phòto ñ.png')).toBe('phòto ñ')
  })

  it('strips characters a zip on Windows would choke on', () => {
    expect(baseName('a<b>c:d"e|f?g*h.png')).toBe('abcdefgh')
  })

  it('falls back to a usable name when nothing survives', () => {
    expect(baseName('.png')).toBe('image') // nothing before the dot to keep
    expect(baseName('???.png')).toBe('image')
    expect(baseName('')).toBe('image')
  })
})

describe('outputName', () => {
  it('swaps in the target extension', () => {
    expect(outputName('photo.png', 'webp')).toBe('photo.webp')
    expect(outputName('scan.jpeg', 'jpg')).toBe('scan.jpg')
  })
})

describe('uniqueNames', () => {
  it('leaves distinct names alone', () => {
    expect(uniqueNames(['a.webp', 'b.webp'])).toEqual(['a.webp', 'b.webp'])
  })

  it('suffixes collisions in order', () => {
    expect(uniqueNames(['logo.webp', 'logo.webp', 'logo.webp'])).toEqual([
      'logo.webp',
      'logo (2).webp',
      'logo (3).webp',
    ])
  })

  it('treats case-insensitive collisions as collisions', () => {
    expect(uniqueNames(['Logo.webp', 'logo.webp'])).toEqual(['Logo.webp', 'logo (2).webp'])
  })

  it('does not create a second collision when the suffix is already taken', () => {
    expect(uniqueNames(['logo (2).webp', 'logo.webp', 'logo.webp'])).toEqual([
      'logo (2).webp',
      'logo.webp',
      'logo (3).webp',
    ])
  })
})

describe('formatBytes', () => {
  it('picks a readable unit', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(999)).toBe('999 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB')
  })

  it('does not print nonsense for missing sizes', () => {
    expect(formatBytes(Number.NaN)).toBe('—')
    expect(formatBytes(-1)).toBe('—')
  })
})

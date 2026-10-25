import { describe, expect, it } from 'vitest'
import { formatDms } from './angle'
import { convertRows, MAX_LINES, parseBatch, splitLine, toCsv } from './batch'
import { fromGrid, toGrid } from './mutm'

describe('splitLine', () => {
  it('splits on tabs, commas, semicolons or spaces', () => {
    expect(splitLine('a\tb\t c')).toEqual(['a', 'b', 'c'])
    expect(splitLine('a, b;c')).toEqual(['a', 'b', 'c'])
    expect(splitLine('  a   b c ')).toEqual(['a', 'b', 'c'])
    expect(splitLine('"P, 1",500000,"3000000"')).toEqual(['P, 1', '500000', '3000000'])
    expect(splitLine('"say ""hi""",1')).toEqual(['say "hi"', '1'])
  })
})

describe('parseBatch, grid input', () => {
  it('reads E,N lines with and without ids, header tolerated, extras kept', () => {
    const text = [
      'Point,Easting,Northing,Height,Code',
      'BM1,630391.974,3066418.735,1337.2,CP',
      '2,498252.433,3121125.059,830.5',
      '',
      '500000 3000000',
    ].join('\n')
    const { rows, bad, header, skipped } = parseBatch(text, 'grid', 'auto')
    expect(bad).toEqual([])
    expect(skipped).toBe(0)
    expect(header).toEqual(['Point', 'Easting', 'Northing', 'Height', 'Code'])
    expect(rows.map((r) => [r.line, r.id, r.first, r.second])).toEqual([
      [2, 'BM1', 630391.974, 3066418.735],
      [3, '2', 498252.433, 3121125.059],
      [5, '', 500000, 3000000],
    ])
    expect(rows[0].extras).toEqual([{ column: 3, text: '1337.2' }, { column: 4, text: 'CP' }])
    expect(rows[1].extras).toEqual([{ column: 3, text: '830.5' }])
  })

  it('takes a trailing height as an extra, not as an id', () => {
    const { rows } = parseBatch('630391.974\t3066418.735\t1337.2', 'grid', 'auto')
    expect(rows[0]).toMatchObject({ id: '', first: 630391.974, second: 3066418.735, extras: [{ column: 2, text: '1337.2' }] })
  })

  it('orders by size in auto, or as told', () => {
    expect(parseBatch('P1,3066418.735,630391.974', 'grid', 'auto').rows[0]).toMatchObject({ first: 630391.974, second: 3066418.735 })
    expect(parseBatch('P1,3066418.735,630391.974', 'grid', 'swapped').rows[0]).toMatchObject({ first: 630391.974, second: 3066418.735 })
    expect(parseBatch('P1,3066418.735,630391.974', 'grid', 'normal').rows[0]).toMatchObject({ first: 3066418.735, second: 630391.974 })
  })

  it('lists bad lines with a reason and converts the rest', () => {
    const text = ['E,N', '630391.974,3066418.735', 'P2,abc,3066418', 'P3', 'P4,630391.974', `P5,${'9'.repeat(400)}x,1`, '630391,3066418', 'x'.repeat(600)].join('\n')
    const { rows, bad } = parseBatch(text, 'grid', 'auto')
    expect(rows.map((r) => r.line)).toEqual([2, 7])
    expect(bad.map((b) => b.line)).toEqual([3, 4, 5, 6, 8])
    expect(bad[0].reason).toBe('“abc” is not a number in metres')
    expect(bad[1].reason).toMatch(/easting and a northing/)
    expect(bad[2].reason).toMatch(/easting and a northing/)
    expect(bad[4].reason).toMatch(/too long/)
    // A huge field is never echoed whole.
    for (const b of bad) expect(b.reason.length).toBeLessThan(80)
  })

  it('reads Devanagari digits', () => {
    expect(parseBatch('६३०३९१.९७४,३०६६४१८.७३५', 'grid', 'auto').rows[0]).toMatchObject({ first: 630391.974, second: 3066418.735 })
  })

  it('stops at MAX_LINES and counts what it skipped', () => {
    const text = Array.from({ length: MAX_LINES + 5 }, () => '500000,3000000').join('\n')
    const { rows, skipped } = parseBatch(text, 'grid', 'auto')
    expect(rows.length).toBe(MAX_LINES)
    expect(skipped).toBe(5)
  })
})

describe('parseBatch, latitude/longitude input', () => {
  it('reads decimal and DMS, ids, and orders by size or by letters', () => {
    const text = [
      'name\tlat\tlon',
      'KTM\t27.7172\t85.3240',
      `PKR\t28°12'34.6"N\t83°59'08.2"E`,
      `BRT\t87°16'18.5"E\t26°27'09"N`,
      '4 85.3240 27.7172 1300',
    ].join('\n')
    const { rows, bad, header } = parseBatch(text, 'geo', 'auto')
    expect(bad).toEqual([])
    expect(header).toEqual(['name', 'lat', 'lon'])
    expect(rows.map((r) => r.id)).toEqual(['KTM', 'PKR', 'BRT', '4'])
    expect(rows[0]).toMatchObject({ first: 27.7172, second: 85.324 })
    expect(rows[1].first).toBeCloseTo(28 + 12 / 60 + 34.6 / 3600, 12)
    expect(rows[2].first).toBeCloseTo(26 + 27 / 60 + 9 / 3600, 12)
    expect(rows[3]).toMatchObject({ first: 27.7172, second: 85.324, extras: [{ column: 3, text: '1300' }] })
  })

  it('refuses letters that contradict the chosen order', () => {
    const { bad } = parseBatch(`85.3E,27.7N\n27.7N,27.7S`, 'geo', 'normal')
    expect(bad.map((b) => b.reason)).toEqual([
      'Latitude was expected first, but the letters say longitude',
      'Both values name the same axis (N/S or E/W)',
    ])
  })
})

describe('convertRows and toCsv', () => {
  it('converts grid rows in the chosen zone and geo rows in their nearest zone', () => {
    const geo = { lat: 27.7172, lon: 85.324 }
    const grid = toGrid(geo, 84, 'epsg6208')
    const g = convertRows(parseBatch(`KTM,${grid.e},${grid.n}`, 'grid', 'auto').rows, 'grid', 84, 'epsg6208')
    expect(g.bad).toEqual([])
    // Not an exact round trip: a 2D shift takes height 0 on whichever side it starts, as PROJ does (about 2 mm here).
    expect(g.done[0].geo.lat).toBeCloseTo(geo.lat, 7)
    expect(g.done[0].geo.lon).toBeCloseTo(geo.lon, 7)

    const w = convertRows(parseBatch('A,27.7172,85.324\nB,26.4525,87.2718\nC,28.9631,80.1816', 'geo', 'auto').rows, 'geo', 'auto', 'epsg6208')
    expect(w.done.map((c) => c.zone)).toEqual([84, 87, 81])
    const fixed = convertRows(parseBatch('A,27.7172,85.324\nB,26.4525,87.2718', 'geo', 'auto').rows, 'geo', 84, 'epsg6208')
    expect(fixed.done.map((c) => c.zone)).toEqual([84, 84])
    expect(fixed.done[1].warnings).toEqual(['zone'])
    const back = fromGrid(fixed.done[1].grid, 84, 'epsg6208')
    expect(back.lat).toBeCloseTo(26.4525, 7)
  })

  it('moves impossible grid rows to bad', () => {
    const r = convertRows(parseBatch('P,630391,3066418\nQ,-5,3066418', 'grid', 'auto').rows, 'grid', 84, 'none')
    expect(r.done.length).toBe(1)
    expect(r.bad).toEqual([{ line: 2, reason: expect.stringMatching(/Easting/) }])
  })

  it('writes CSV with extras named from the header and quoted where needed', () => {
    const parsed = parseBatch('Point,E,N,Height,Code\n"BM, 1",630391.974,3066418.735,1337.2,CP\nX,51 000,3000000', 'grid', 'auto')
    const { done } = convertRows(parsed.rows, 'grid', 84, 'epsg6208')
    const csv = toCsv(done, parsed.header, formatDms).split('\r\n')
    expect(csv[0]).toBe('id,zone,easting,northing,latitude,longitude,latitude_dms,longitude_dms,Height,Code,note')
    expect(csv[1]).toMatch(/^"BM, 1",84,630391\.974,3066418\.735,27\.\d{8},85\.\d{8},27°\d\d'\d\d\.\d{4}"N|^"BM, 1"/)
    expect(csv[1].endsWith(',1337.2,CP,')).toBe(true)
    expect(csv.length).toBe(3) // header, one row, trailing empty
    expect(parsed.bad.map((b) => b.line)).toEqual([3])
  })
})

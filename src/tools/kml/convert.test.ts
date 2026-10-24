import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { dxfToKml, kmlToDxf, sniff, type DxfToKmlOptions, type KmlToDxfOptions } from './convert'
import { readKml } from './kml/read'
import { SAMPLE_KML } from './sample'
import fixtureText from './fixtures/entities.dxf?raw'

const enc = (s: string) => new TextEncoder().encode(s)
const toDxf: KmlToDxfOptions = { crs: 'utm-auto', units: 'crs', altitude: false, labels: true, folders: true }
const toKml: DxfToKmlOptions = { crs: '', units: 'auto', altitude: false, polygons: true, texts: true, includeHidden: false, kmz: false }

async function sampleDxf(options = toDxf) {
  const result = await kmlToDxf('bern.kml', enc(SAMPLE_KML), options)
  if (!result.ok) throw new Error(result.error)
  return result.summary
}

describe('KML → DXF → KML', () => {
  it('projects into the UTM zone at the data and back to the same places', async () => {
    const dxf = await sampleDxf()
    expect(dxf.crs?.label).toBe('UTM zone 32N (WGS84)')
    expect(dxf.output?.name).toBe('bern.dxf')

    const back = await dxfToKml('bern.dxf', enc(dxf.output!.data as string), toKml)
    if (!back.ok) throw new Error(back.error)
    // The CRS comment the DXF carries is offered back.
    expect(back.summary.needsCrs).toBe(true)
    expect(back.summary.suggestion?.proj).toBe('+proj=utm +zone=32 +datum=WGS84 +units=m +no_defs')

    const done = await dxfToKml('bern.dxf', enc(dxf.output!.data as string), { ...toKml, crs: back.summary.suggestion!.proj })
    if (!done.ok) throw new Error(done.error)
    const original = readKml(SAMPLE_KML)
    const round = readKml(done.summary.output!.data as string)
    const route = (r: typeof original) => r.features.find((f) => f.geometry.type === 'line')!.geometry
    const a = route(original), b = route(round)
    if (a.type !== 'line' || b.type !== 'line') throw new Error('no route')
    expect(b.coords.length).toBe(a.coords.length)
    for (let i = 0; i < a.coords.length; i += 3) {
      expect(Math.abs(a.coords[i] - b.coords[i])).toBeLessThan(1e-8)
      expect(Math.abs(a.coords[i + 1] - b.coords[i + 1])).toBeLessThan(1e-8)
    }
    // Folders survive as layers (R12-cleaned). A DXF POINT has no name, so
    // names come back through the TEXT labels written beside the points.
    expect(round.layers).toEqual(['Site', 'Routes', 'Points_of_interest'])
    expect(round.features.filter((f) => f.name === 'Bärengraben')).toHaveLength(1)
  })

  it('keeps altitude as Z when asked', async () => {
    const kml = SAMPLE_KML.replace('7.44795,46.94799,0', '7.44795,46.94799,542.5')
    const result = await kmlToDxf('z.kml', enc(kml), { ...toDxf, altitude: true })
    if (!result.ok) throw new Error(result.error)
    expect(result.summary.output!.data).toMatch(/\n30\r\n542\.5\r\n/)
  })

  it('writes US survey feet when the CRS says so', async () => {
    const proj = '+proj=lcc +lat_0=33.5 +lon_0=-118 +lat_1=35.4666666666667 +lat_2=34.0333333333333 +x_0=2000000.0001016 +y_0=500000.0001016 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=us-ft +no_defs'
    const kml = '<kml><Placemark><Point><coordinates>-118.24,34.05</coordinates></Point></Placemark></kml>'
    const result = await kmlToDxf('la.kml', enc(kml), { ...toDxf, crs: proj })
    if (!result.ok) throw new Error(result.error)
    // pyproj: 6487519.9…, 1841047.4… US ft (see proj/reference.json).
    const ref = (await import('./proj/reference.json')).default.find((r) => r.proj === proj)!.points[0]
    const text = result.summary.output!.data as string
    expect(text).toContain(`\r\n10\r\n${ref[2].toFixed(4).replace(/0+$/, '')}`)
  })

  it('declares its units, so AutoCAD does not read metres as inches', async () => {
    const text = (await sampleDxf()).output!.data as string
    // Decimal linear units, metres, metric.
    expect(text).toMatch(/\$LUNITS\r\n70\r\n2\r\n/)
    expect(text).toMatch(/\$INSUNITS\r\n70\r\n6\r\n/)
    expect(text).toMatch(/\$MEASUREMENT\r\n70\r\n1\r\n/)
  })

  it('writes feet when asked, and the feet drawing reads back to the same places', async () => {
    const metres = await sampleDxf()
    const feet = await sampleDxf({ ...toDxf, units: 'ft' })
    const text = feet.output!.data as string
    expect(text).toMatch(/\$INSUNITS\r\n70\r\n2\r\n/)
    expect(text).toMatch(/\$MEASUREMENT\r\n70\r\n0\r\n/)
    // The CRS comment would claim metres; a rescaled file doesn't carry it.
    expect(text).not.toMatch(/\r\nCRS: /)
    expect(feet.facts.find(([k]) => k === 'Drawing units')?.[1]).toBe('feet, decimal ($INSUNITS 2)')
    // Every coordinate is the metre value / 0.3048.
    const first = (t: string) => Number(/\nVERTEX\r\n8\r\n[^\r]*\r\n10\r\n([^\r]+)/.exec(t)![1])
    expect(first(text)).toBeCloseTo(first(metres.output!.data as string) / 0.3048, 3)

    const back = await dxfToKml('bern.dxf', enc(text), { ...toKml, crs: metres.crs!.proj })
    if (!back.ok) throw new Error(back.error)
    const route = (r: ReturnType<typeof readKml>) => r.features.find((f) => f.geometry.type === 'line')!.geometry
    const a = route(readKml(SAMPLE_KML)), b = route(readKml(back.summary.output!.data as string))
    if (a.type !== 'line' || b.type !== 'line') throw new Error('no route')
    for (let i = 0; i < a.coords.length; i += 3) expect(Math.abs(a.coords[i] - b.coords[i])).toBeLessThan(1e-8)
  })

  it('reads an architectural-units drawing without $INSUNITS as inches', async () => {
    const dxf = '0\nSECTION\n2\nHEADER\n9\n$LUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nPOINT\n8\n0\n10\n19685039.37\n20\n204724409.45\n0\nENDSEC\n0\nEOF\n'
    const result = await dxfToKml('in.dxf', enc(dxf), { ...toKml, crs: '+proj=utm +zone=32 +datum=WGS84' })
    if (!result.ok) throw new Error(result.error)
    expect(result.summary.insunits).toBe(1)
    expect(result.summary.notes.map((n) => n.text).join()).toMatch(/architectural units.*inches/)
    const g = readKml(result.summary.output!.data as string).features[0].geometry
    // 19,685,039.37 in = 500,000 m: the zone's central meridian.
    expect(g.type === 'point' && g.at[0]).toBeCloseTo(9, 6)
  })

  it('reads and writes KMZ', async () => {
    const zip = new JSZip()
    zip.file('doc.kml', SAMPLE_KML)
    zip.file('files/icon.png', new Uint8Array([1, 2, 3]))
    const kmz = await zip.generateAsync({ type: 'uint8array' })
    expect(sniff(kmz, 'site.kmz')).toBe('kml-to-dxf')
    const result = await kmlToDxf('site.kmz', kmz, toDxf)
    if (!result.ok) throw new Error(result.error)
    expect(result.summary.notes[0].text).toMatch(/Read doc\.kml from the KMZ; 1 other file/)

    const back = await dxfToKml('site.dxf', enc(result.summary.output!.data as string), { ...toKml, crs: result.summary.crs!.proj, kmz: true })
    if (!back.ok) throw new Error(back.error)
    expect(back.summary.output!.name).toBe('site.kmz')
    const unzipped = await JSZip.loadAsync(back.summary.output!.data as Uint8Array)
    expect(readKml(await unzipped.file('doc.kml')!.async('string')).features.length).toBeGreaterThan(5)
  })
})

describe('DXF → KML', () => {
  const fixture = enc(fixtureText)

  it('counts entities as drawn, nested block references included', async () => {
    const result = await dxfToKml('entities.dxf', fixture, { ...toKml, crs: '+proj=utm +zone=32 +datum=WGS84' })
    if (!result.ok) throw new Error(result.error)
    expect(Object.fromEntries(result.summary.counts)).toMatchObject({ INSERT: 5, LWPOLYLINE: 1, HATCH: 1, SPLINE: 2, TEXT: 1, MTEXT: 1 })
  })

  it('scales drawing units into the CRS units, from $INSUNITS or the menu', async () => {
    const dxf = (insunits: number) => `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n${insunits}\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nPOINT\n8\n0\n10\n500000000\n20\n5200000000\n0\nENDSEC\n0\nEOF\n`
    const at = async (text: string, units = 'auto') => {
      const result = await dxfToKml('mm.dxf', enc(text), { ...toKml, crs: '+proj=utm +zone=32 +datum=WGS84', units })
      if (!result.ok) throw new Error(result.error)
      const g = readKml(result.summary.output!.data as string).features[0].geometry
      return g.type === 'point' ? g.at.slice(0, 2) : []
    }
    const [lon, lat] = await at(dxf(4))
    expect(lon).toBeCloseTo(9, 9)
    expect(lat).toBeCloseTo(46.93, 1)
    expect(await at(dxf(0), 'mm')).toEqual([lon, lat])
  })

  it('suggests degrees for drawings in longitude/latitude', async () => {
    const dxf = '0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\n7.4\n20\n46.9\n11\n7.5\n21\n47.0\n0\nENDSEC\n0\nEOF\n'
    const result = await dxfToKml('deg.dxf', enc(dxf), toKml)
    if (!result.ok) throw new Error(result.error)
    expect(result.summary.suggestion?.proj).toBe('+proj=longlat +datum=WGS84 +no_defs')
  })

  it('says when no coordinate lands on Earth', async () => {
    const dxf = '0\nSECTION\n2\nENTITIES\n0\nPOINT\n8\n0\n10\n1e12\n20\n1e12\n0\nENDSEC\n0\nEOF\n'
    const result = await dxfToKml('far.dxf', enc(dxf), { ...toKml, crs: '+proj=longlat +datum=WGS84' })
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/No coordinate lands on the Earth/) })
  })
})

describe('sniff', () => {
  it('names DWG and binary DXF instead of failing on them', () => {
    expect(sniff(enc('AC1032\0\0\0'), 'plan.dwg')).toEqual({ error: expect.stringMatching(/DWG/) })
    expect(sniff(enc('AutoCAD Binary DXF\r\n\x1a\0'), 'plan.dxf')).toEqual({ error: expect.stringMatching(/binary DXF/) })
    expect(sniff(enc('  0\r\nSECTION\r\n'), 'x')).toBe('dxf-to-kml')
    expect(sniff(enc('<?xml version="1.0"?><kml>'), 'x')).toBe('kml-to-dxf')
    expect(sniff(enc('hello'), 'x.txt')).toEqual({ error: 'Not a KML, KMZ or DXF file.' })
  })
})

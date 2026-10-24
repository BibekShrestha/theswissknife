import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { solvePlot } from '../plot/solve'
import { DEFAULTS, readFragment, writeFragment } from '../share'
import { ellipsoidArea } from './geodesy'
import { readShapes } from './kml'
import { kmlFromFile, LoadError } from './load'
import { toPlot } from './sketch'
import reference from './reference.json'

const enc = (s: string) => new TextEncoder().encode(s)
const coords = (ring: number[][], close = true) => [...ring, ...(close ? [ring[0]] : [])].map(([lon, lat]) => `${lon},${lat},0`).join(' ')
const field = (reference as unknown as Record<string, { ring: number[][]; area: number }>).field
const hole = (reference as unknown as Record<string, { ring: number[][] }>).hole

/** What Google Earth Pro writes for a polygon saved with "Save Place As…". */
const earthKml = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><name>plot.kml</name>${body}</Document></kml>`
const polygon = (name: string, outer: number[][], inner?: number[][]) => `<Placemark><name>${name}</name><Polygon><tessellate>1</tessellate>
<outerBoundaryIs><LinearRing><coordinates>${coords(outer)}</coordinates></LinearRing></outerBoundaryIs>
${inner ? `<innerBoundaryIs><LinearRing><coordinates>${coords(inner)}</coordinates></LinearRing></innerBoundaryIs>` : ''}</Polygon></Placemark>`

describe('readShapes', () => {
  it('reads polygons with holes, closed lines, folders and MultiGeometry', () => {
    const read = readShapes(earthKml(`
      ${polygon('Field', field.ring, hole.ring)}
      <Folder><name>Ward 4</name>
        <Placemark><name>Closed path</name><LineString><coordinates>${coords(field.ring)}</coordinates></LineString></Placemark>
        <Placemark><name>Two parts</name><MultiGeometry>${polygon('', field.ring).replace(/<\/?Placemark>|<name><\/name>/g, '')}<Point><coordinates>84.4,27.5</coordinates></Point></MultiGeometry></Placemark>
      </Folder>
      <Placemark><name>Road</name><LineString><coordinates>${coords(field.ring, false)}</coordinates></LineString></Placemark>`))
    expect(read.shapes.map((s) => [s.name, s.folder, s.rings.length])).toEqual([['Field', '', 2], ['Closed path', 'Ward 4', 1], ['Two parts', 'Ward 4', 1]])
    expect(read.shapes[0].rings[0]).toHaveLength(field.ring.length * 2)
    expect(read.paths).toEqual(['Road'])
    expect(read.points).toBe(1)
  })

  it('measures what Google Earth saved like pyproj does', () => {
    const [shape] = readShapes(earthKml(polygon('Field', field.ring))).shapes
    expect(Math.abs(ellipsoidArea(shape.rings) - field.area) / field.area).toBeLessThan(1e-7)
  })

  it('counts unreadable coordinates and refuses non-KML', () => {
    expect(readShapes(earthKml(`<Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>0,0 1,0 x,y 1,1 0,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`)).badCoordinates).toBe(1)
    expect(() => readShapes('<svg/>')).toThrow(/not a KML/)
  })
})

describe('kmlFromFile', () => {
  it('reads KML and the doc.kml inside a KMZ', async () => {
    const kml = earthKml(polygon('Field', field.ring))
    expect(await kmlFromFile('a.kml', enc(kml))).toBe(kml)
    const zip = new JSZip()
    zip.file('files/icon.png', new Uint8Array([1]))
    zip.file('doc.kml', kml)
    expect(await kmlFromFile('a.kmz', await zip.generateAsync({ type: 'uint8array' }))).toBe(kml)
  })

  it('explains what it cannot read', async () => {
    await expect(kmlFromFile('plan.dxf', enc('0\nSECTION'))).rejects.toThrow(/KML ⇄ DXF/)
    await expect(kmlFromFile('notes.txt', enc('hello'))).rejects.toThrow(LoadError)
    const empty = new JSZip()
    empty.file('readme.txt', 'x')
    await expect(kmlFromFile('a.kmz', await empty.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/no \.kml/)
  })
})

describe('toPlot', () => {
  it('turns an outline into a sketch that solves to the same area', () => {
    const outer = field.ring.flat()
    for (const unit of ['m', 'ft'] as const) {
      const plot = toPlot(outer, unit)!
      expect(plot.closed).toBe(true)
      expect(plot.diagonals.map((d) => [d.a, d.b])).toEqual([[0, 2], [0, 3]])
      const solved = solvePlot(plot, unit)
      if (!solved.ok) throw new Error(solved.message)
      const m2 = solved.area * (unit === 'ft' ? 0.09290304 : 1)
      // Lengths are rounded to 2 decimals, so allow that much.
      expect(Math.abs(m2 - field.area) / field.area).toBeLessThan(1e-4)
      expect(solved.conflicts).toEqual([])
    }
  })

  it('refuses outlines the sketch cannot hold', () => {
    expect(toPlot([0, 0, 1, 1], 'm')).toBeNull()
    expect(toPlot(Array.from({ length: 27 }, (_, i) => [Math.cos(i / 4.3), Math.sin(i / 4.3)]).flat(), 'm')).toBeNull()
  })
})

describe('share link', () => {
  it('never carries a dropped file', () => {
    expect(writeFragment({ ...DEFAULTS, mode: 'earth', values: [] })).toBe('#m=earth')
    expect(readFragment('#m=earth&p=1.2')).toEqual({ ...DEFAULTS, mode: 'earth', values: [] })
  })
})

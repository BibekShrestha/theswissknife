import { describe, expect, it } from 'vitest'
import { decodeDxf, dxfText, mtextPlain, nestRings, readDxf } from './read'
import { dxfString, writeDxf } from './write'
import { ACI, nearestAci } from './aci'
import type { Feature } from '../model'
import expected from '../fixtures/entities.expected.json'
// entities.dxf and its expected extents are written by fixtures/generate.py (ezdxf).
import fixture from '../fixtures/entities.dxf?raw'

function boxes(features: Feature[]) {
  const out: Record<string, number[]> = {}
  for (const f of features) {
    const g = f.geometry
    if (g.type === 'text') continue
    const coords = g.type === 'point' ? g.at : g.type === 'line' ? g.coords : g.rings.flat()
    const box = (out[f.layer] ??= [Infinity, Infinity, -Infinity, -Infinity])
    for (let i = 0; i < coords.length; i += 3) {
      box[0] = Math.min(box[0], coords[i]); box[1] = Math.min(box[1], coords[i + 1])
      box[2] = Math.max(box[2], coords[i]); box[3] = Math.max(box[3], coords[i + 1])
    }
  }
  return out
}

describe('readDxf against ezdxf', () => {
  const read = readDxf(fixture, { includeHidden: false })
  const byLayer = (layer: string) => read.features.filter((f) => f.layer === layer)

  it('places every layer where ezdxf does (blocks exploded, OCS applied)', () => {
    const got = boxes(read.features)
    expect(Object.keys(got).sort()).toEqual(Object.keys(expected).sort())
    for (const [layer, box] of Object.entries(expected as Record<string, number[]>)) {
      // Curves are flattened in 3° steps, so extremes can fall short by the chord error.
      box.forEach((v, i) => expect(Math.abs(got[layer][i] - v), `${layer}[${i}] = ${got[layer][i]}, ezdxf ${v}`).toBeLessThan(0.02))
    }
  })

  it('reads the header', () => {
    expect(read.version).toBe('AC1032')
    expect(read.insunits).toBe(6)
  })

  it('inherits BYBLOCK colour and layer 0 from the insert, keeps its own layer otherwise', () => {
    const trees = byLayer('Trees')
    expect(trees).toHaveLength(1)
    expect(trees[0].color).toEqual({ r: 0, g: 255, b: 0 })
    // GROVE inserts TREE on layer 0, so its circles land on Grove, coloured BYLAYER → cyan.
    expect(byLayer('Grove').every((f) => f.color?.g === 255 && f.color.b === 255 && f.color.r === 0)).toBe(true)
    expect(byLayer('Trunks').every((f) => f.color?.r === ACI[30].r && f.color.g === ACI[30].g)).toBe(true)
    // 1 + 2 nested + 6 arrayed trunks.
    expect(byLayer('Trunks')).toHaveLength(9)
  })

  it('mirrors an OCS circle with extrusion (0, 0, -1)', () => {
    const [circle] = byLayer('Mirror')
    if (circle.geometry.type !== 'line') throw new Error('expected a ring')
    const c = circle.geometry.coords
    let sx = 0, sy = 0
    for (let i = 0; i < c.length; i += 3) { sx += c[i]; sy += c[i + 1] }
    expect(sx / (c.length / 3)).toBeCloseTo(-50, 6)
    expect(sy / (c.length / 3)).toBeCloseTo(0, 6)
    expect(circle.geometry.closed).toBe(true)
  })

  it('turns hatch boundaries into polygons with holes', () => {
    const hatches = byLayer('Hatch')
    expect(hatches.map((f) => f.geometry.type === 'polygon' ? f.geometry.rings.length : 0).sort()).toEqual([1, 2])
  })

  it('reads text and strips MTEXT formatting', () => {
    const notes = byLayer('Notes').map((f) => f.geometry.type === 'text' ? [f.geometry.text, f.geometry.at[0], f.geometry.at[1]] : null)
    expect(notes).toContainEqual(['Hello', 10, 10])
    expect(notes).toContainEqual(['Bold line second line', 20, 20])
  })

  it('leaves out hidden layers, paper space and dimensions, and says so', () => {
    const text = read.notes.map((n) => n.text).join('\n')
    expect(text).toMatch(/off or frozen.*Hidden/)
    expect(text).toMatch(/LINE in paper space/)
    expect(text).toMatch(/dimension/)
    const withHidden = readDxf(fixture, { includeHidden: true })
    expect(withHidden.features.some((f) => f.layer === 'Hidden')).toBe(true)
  })
})

describe('DXF strings', () => {
  it('escapes for R12 and decodes back', () => {
    expect(dxfString('Bärengraben ^ ok\n2')).toBe('B\\U+00E4rengraben ^  ok 2')
    expect(dxfText('B\\U+00E4rengraben ^  ok')).toBe('Bärengraben ^ ok')
    expect(dxfText('%%c50 %%d %%p0.5 %%%')).toBe('⌀50 ° ±0.5 %')
  })

  it('strips MTEXT codes', () => {
    expect(mtextPlain('{\\H2.5;\\C1;Red}\\Ptext \\S1/2; \\{x\\}')).toBe('Red text 1/2 {x}')
  })

  it('decodes old code pages and UTF-8', () => {
    const latin = new Uint8Array([...new TextEncoder().encode('0\nSECTION\n2\nHEADER\n9\n$DWGCODEPAGE\n3\nANSI_1251\n0\nENDSEC\n0\nEOF\n'), 0xc4])
    expect(decodeDxf(latin).encoding).toBe('windows-1251')
    expect(decodeDxf(latin).text.endsWith('Д')).toBe(true)
    expect(decodeDxf(new TextEncoder().encode('0\nEOF\nÄ')).encoding).toBe('UTF-8')
  })
})

describe('writeDxf → readDxf', () => {
  it('round-trips geometry, layers and colours', () => {
    const features: Feature[] = [
      { geometry: { type: 'line', coords: [0, 0, 0, 10, 0, 0, 10, 5, 0], closed: true }, name: 'a', layer: 'Roads / Primary', color: { r: 255, g: 0, b: 0 }, source: 'test' },
      { geometry: { type: 'point', at: [3, 4, 0] }, name: 'p', layer: 'Roads / Primary', color: { r: 0, g: 0, b: 255 }, source: 'test' },
      { geometry: { type: 'text', at: [1, 1, 0], text: 'Zürich', height: 2, rotation: 0 }, name: '', layer: '', color: null, source: 'test' },
      { geometry: { type: 'polygon', rings: [[0, 0, 0, 4, 0, 0, 4, 4, 0], [1, 1, 0, 2, 1, 0, 2, 2, 0]] }, name: '', layer: 'Parcels', color: null, source: 'test' },
    ]
    const written = writeDxf(features, ['Roads / Primary', 'Parcels'], { comments: ['CRS: +proj=utm +zone=32 +datum=WGS84'], precision: 4, use3d: false, textHeight: 1 })
    const read = readDxf(written.text, { includeHidden: false })
    expect(read.crsComment).toBe('+proj=utm +zone=32 +datum=WGS84')
    expect(read.version).toBe('AC1009')
    expect(read.layers).toEqual(['0', 'Roads_Primary', 'Parcels'])
    const [line, point, text, ...rings] = read.features
    expect(line.geometry).toEqual({ type: 'line', coords: [0, 0, 0, 10, 0, 0, 10, 5, 0], closed: true })
    expect(line.color).toEqual({ r: 255, g: 0, b: 0 })
    expect(point.color).toEqual({ r: 0, g: 0, b: 255 })
    expect(text.geometry).toMatchObject({ type: 'text', text: 'Zürich', at: [1, 1, 0] })
    expect(rings).toHaveLength(2)
  })

  it('keeps layer names unique after cleaning', () => {
    const f = (layer: string): Feature => ({ geometry: { type: 'point', at: [0, 0, 0] }, name: '', layer, color: null, source: 't' })
    const written = writeDxf([f('a/b'), f('a b'), f('x'.repeat(40))], [], { comments: [], precision: 4, use3d: false, textHeight: 1 })
    expect([...written.layerNames.values()]).toEqual(['a_b', 'a_b~2', 'x'.repeat(31)])
  })
})

describe('ACI', () => {
  it('matches AutoCAD’s palette at known indices', () => {
    expect(ACI[1]).toEqual({ r: 255, g: 0, b: 0 })
    expect(ACI[21]).toEqual({ r: 255, g: 159, b: 127 })
    expect(ACI[42]).toEqual({ r: 165, g: 124, b: 0 })
    expect(ACI[29]).toEqual({ r: 38, g: 23, b: 19 })
    expect(ACI[250]).toEqual({ r: 51, g: 51, b: 51 })
    expect(ACI).toHaveLength(256)
  })

  it('finds exact and nearest colours', () => {
    for (const i of [1, 3, 5, 30, 141, 252]) expect(nearestAci(ACI[i])).toBe(i)
    expect(nearestAci({ r: 0, g: 0, b: 0 })).toBe(7)
    expect(nearestAci({ r: 250, g: 2, b: 3 })).toBe(1)
  })
})

describe('nestRings', () => {
  it('pairs holes with the smallest ring around them', () => {
    const square = (o: number, s: number) => [o, o, 0, o + s, o, 0, o + s, o + s, 0, o, o + s, 0]
    const polygons = nestRings([square(0, 100), square(10, 50), square(20, 10), square(200, 5)])
    expect(polygons.map((p) => p.length)).toEqual([2, 1, 1])
  })
})

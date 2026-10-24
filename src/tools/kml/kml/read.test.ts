import { describe, expect, it } from 'vitest'
import { parseKmlColor, readKml } from './read'
import { parseXml } from './xml'
import { escapeXml, writeKml } from './write'

const wrap = (body: string, head = '') => `<?xml version="1.0"?>${head}<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><name>Doc</name>${body}</Document></kml>`

describe('parseXml', () => {
  it('reads elements, attributes, CDATA and entities', () => {
    const doc = parseXml('<a x="1 &amp; 2" y=\'q\'><b>x &lt; y &#x1F600;</b><c/><![CDATA[<raw>]]></a>')
    const a = doc.children[0]
    expect(a.attrs).toEqual({ x: '1 & 2', y: 'q' })
    expect(a.children.map((c) => c.name)).toEqual(['b', 'c'])
    expect(a.children[0].text).toBe('x < y 😀')
    expect(a.text).toBe('<raw>')
  })

  it('never expands DTD entities', () => {
    const bomb = '<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;">]><a>&lol2;</a>'
    expect(parseXml(bomb).children[0].text).toBe('&lol2;')
  })

  it('refuses a cut-off tag', () => {
    expect(() => parseXml('<a><b attr="x')).toThrow(/cut off/)
  })
})

describe('readKml', () => {
  it('resolves shared styles, StyleMaps and inline overrides', () => {
    const read = readKml(wrap(`
      <Style id="red"><LineStyle><color>ff0000ff</color></LineStyle></Style>
      <StyleMap id="m"><Pair><key>normal</key><styleUrl>#red</styleUrl></Pair></StyleMap>
      <Placemark><styleUrl>#m</styleUrl><LineString><coordinates>1,2 3,4</coordinates></LineString></Placemark>
      <Placemark><styleUrl>#red</styleUrl><Style><LineStyle><color>ff00ff00</color></LineStyle></Style><LineString><coordinates>1,2 3,4</coordinates></LineString></Placemark>`))
    expect(read.features.map((f) => f.color)).toEqual([{ r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }])
  })

  it('makes folder paths into layers', () => {
    const read = readKml(wrap('<Folder><name>A</name><Folder><name>B</name><Placemark><Point><coordinates>1,2</coordinates></Point></Placemark></Folder></Folder><Placemark><Point><coordinates>1,2</coordinates></Point></Placemark>'))
    expect(read.features.map((f) => f.layer)).toEqual(['A / B', ''])
    expect(read.documentName).toBe('Doc')
  })

  it('reads every geometry kind', () => {
    const read = readKml(wrap(`
      <Placemark><name>multi</name><MultiGeometry>
        <Point><coordinates>1,2,3</coordinates></Point>
        <Polygon><outerBoundaryIs><LinearRing><coordinates>0,0 1,0 1,1 0,0</coordinates></LinearRing></outerBoundaryIs>
          <innerBoundaryIs><LinearRing><coordinates>.2,.1 .5,.1 .5,.4 .2,.1</coordinates></LinearRing></innerBoundaryIs></Polygon>
      </MultiGeometry></Placemark>
      <Placemark><LineString><coordinates>0,0 1,1 0,0</coordinates></LineString></Placemark>
      <Placemark><gx:Track><when>2020</when><gx:coord>1 2 3</gx:coord><gx:coord>4 5 6</gx:coord></gx:Track></Placemark>
      <Placemark><Model><Location><longitude>9</longitude><latitude>8</latitude></Location></Model></Placemark>`))
    expect(read.features.map((f) => f.geometry.type)).toEqual(['point', 'polygon', 'line', 'line', 'point'])
    const polygon = read.features[1].geometry
    expect(polygon.type === 'polygon' && polygon.rings.map((r) => r.length / 3)).toEqual([3, 3])
    const closed = read.features[2].geometry
    expect(closed.type === 'line' && closed.closed).toBe(true)
    expect(read.features[3].geometry).toEqual({ type: 'line', coords: [1, 2, 3, 4, 5, 6], closed: false })
    expect(read.hasAltitude).toBe(true)
  })

  it('tolerates spaces after commas and counts bad tuples', () => {
    const read = readKml(wrap('<Placemark><LineString><coordinates>1, 2 3 ,4\n x,y 5,95</coordinates></LineString></Placemark>'))
    expect(read.features[0].geometry).toEqual({ type: 'line', coords: [1, 2, 0, 3, 4, 0], closed: false })
    expect(read.notes[0].text).toMatch(/^2 coordinate tuples/)
  })

  it('names what it skips', () => {
    const read = readKml(wrap('<NetworkLink/><GroundOverlay/><Placemark><Point><coordinates>1,2</coordinates></Point></Placemark>'))
    expect(read.notes.map((n) => n.text)).toEqual(['1 × network link (not fetched) — skipped.', '1 × ground overlay image — skipped.'])
  })

  it('refuses files without placemarks', () => {
    expect(() => readKml(wrap(''))).toThrow(/No placemarks/)
    expect(() => readKml('<svg/>')).toThrow(/not <kml>/)
  })

  it('parses aabbggrr colours', () => {
    expect(parseKmlColor('7f00ff00')).toEqual({ rgb: { r: 0, g: 255, b: 0 }, alpha: 127 / 255 })
    expect(parseKmlColor('red')).toBeUndefined()
  })
})

describe('writeKml', () => {
  it('writes polygons, labels and folders that read back', () => {
    const kml = writeKml([
      { geometry: { type: 'polygon', rings: [[0, 0, 5, 1, 0, 5, 1, 1, 5]] }, name: 'P & Q', layer: 'L1', color: { r: 255, g: 0, b: 0 }, source: 't' },
      { geometry: { type: 'text', at: [2, 3, 0], text: 'Label', height: 1, rotation: 0 }, name: 'Label', layer: 'L2', color: null, source: 't' },
    ], { documentName: 'd', altitude: true, polygons: true, layerOrder: ['L2', 'L1'] })
    expect(kml).toContain('<name>P &amp; Q</name>')
    expect(kml).toContain('<altitudeMode>absolute</altitudeMode>')
    expect(kml).toContain('<IconStyle><scale>0</scale></IconStyle>')
    const read = readKml(kml)
    expect(read.layers).toEqual(['L2', 'L1'])
    expect(read.features[1].geometry).toEqual({ type: 'polygon', rings: [[0, 0, 5, 1, 0, 5, 1, 1, 5]] })
    expect(read.features[1].color).toEqual({ r: 255, g: 0, b: 0 })
  })

  it('drops characters XML forbids', () => {
    expect(escapeXml('a\u0001b<')).toBe('ab&lt;')
  })
})

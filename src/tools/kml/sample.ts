/** The "Try a sample" KML: a few shapes in Bern's old town, one folder each. */
export const SAMPLE_NAME = 'bern-sample.kml'

export const SAMPLE_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
<Document>
  <name>Bern sample</name>
  <Style id="block"><LineStyle><color>ff2c2cd9</color><width>3</width></LineStyle><PolyStyle><color>402c2cd9</color></PolyStyle></Style>
  <Style id="trail"><LineStyle><color>ffd98b1e</color><width>3</width></LineStyle></Style>
  <Style id="poi"><IconStyle><color>ff00a5ff</color></IconStyle></Style>
  <Folder>
    <name>Site</name>
    <Placemark>
      <name>Courtyard block</name>
      <styleUrl>#block</styleUrl>
      <Polygon>
        <outerBoundaryIs><LinearRing><coordinates>
          7.44400,46.94700,0 7.44750,46.94780,0 7.44820,46.94620,0 7.44470,46.94550,0 7.44400,46.94700,0
        </coordinates></LinearRing></outerBoundaryIs>
        <innerBoundaryIs><LinearRing><coordinates>
          7.44550,46.94680,0 7.44660,46.94700,0 7.44680,46.94640,0 7.44570,46.94620,0 7.44550,46.94680,0
        </coordinates></LinearRing></innerBoundaryIs>
      </Polygon>
    </Placemark>
  </Folder>
  <Folder>
    <name>Routes</name>
    <Placemark>
      <name>Walk along the Aare</name>
      <styleUrl>#trail</styleUrl>
      <LineString><tessellate>1</tessellate><coordinates>
        7.44050,46.94800 7.44300,46.94920 7.44620,46.94970 7.45000,46.94900 7.45280,46.94750 7.45410,46.94520
      </coordinates></LineString>
    </Placemark>
  </Folder>
  <Folder>
    <name>Points of interest</name>
    <Placemark><name>Zytglogge</name><styleUrl>#poi</styleUrl><Point><coordinates>7.44795,46.94799,0</coordinates></Point></Placemark>
    <Placemark><name>Bundeshaus</name><styleUrl>#poi</styleUrl><Point><coordinates>7.44403,46.94661,0</coordinates></Point></Placemark>
    <Placemark><name>Bärengraben</name><styleUrl>#poi</styleUrl><Point><coordinates>7.45907,46.94776,0</coordinates></Point></Placemark>
  </Folder>
</Document>
</kml>
`

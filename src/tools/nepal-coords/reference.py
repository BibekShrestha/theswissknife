"""
Writes reference.json, the cases mutm.test.ts holds the tool to (1 mm on the
grid, 1e-9 degrees in latitude/longitude).

    python3 -m venv venv && venv/bin/pip install pyproj
    venv/bin/python src/tools/nepal-coords/reference.py

MUTM is not in the EPSG dataset, so each zone is built here as a projected
CRS on EPSG:6207 (Nepal 1981) with EPSG's Transverse Mercator method. WGS 84
cases go through whatever operation PROJ picks between EPSG:4326 and that
CRS, and the script refuses to write unless it is EPSG:6208 — so the
reference checks the tool against the EPSG database itself, not against a
copy of the parameters. "none" cases are the projection alone, from Nepal
1981 latitude/longitude.
"""

import json
import os

import pyproj
from pyproj import CRS, Transformer
from pyproj.crs import ProjectedCRS
from pyproj.crs.coordinate_operation import TransverseMercatorConversion
from pyproj.transformer import TransformerGroup

ZONES = [81, 84, 87]

# Approximate town centres (longitude, latitude). Their exact values don't
# matter; they spread the cases across Nepal.
PLACES = [
    ('Kathmandu', 85.3240, 27.7172),
    ('Pokhara', 83.9856, 28.2096),
    ('Biratnagar', 87.2718, 26.4525),
    ('Nepalgunj', 81.6167, 28.0500),
    ('Mahendranagar', 80.1816, 28.9631),
    ('Namche Bazaar', 86.7140, 27.8069),
    ('Simikot', 81.8187, 29.9696),
    ('Janakpur', 85.9266, 26.7288),
]

# Round grid values, read back to latitude/longitude in every zone.
GRID = [(500000.0, 3000000.0), (400000.0, 3200000.0), (612345.678, 2950000.0), (350000.0, 3300000.0)]


def mutm(zone):
    conversion = TransverseMercatorConversion(
        latitude_natural_origin=0,
        longitude_natural_origin=zone,
        false_easting=500000,
        false_northing=0,
        scale_factor_natural_origin=0.9999,
    )
    return ProjectedCRS(conversion=conversion, geodetic_crs=CRS.from_epsg(6207), name=f'Nepal 1981 / MUTM {zone}')


def transformers(source, target):
    group = TransformerGroup(source, target, always_xy=True)
    best = group.transformers[0]
    return best


def main():
    wgs = CRS.from_epsg(4326)
    nepal = CRS.from_epsg(6207)
    cases = []
    for zone in ZONES:
        grid = mutm(zone)
        for shift, geo in (('epsg6208', wgs), ('none', nepal)):
            fwd = transformers(geo, grid)
            inv = transformers(grid, geo)
            if shift == 'epsg6208':
                for t in (fwd, inv):
                    if 'Nepal 1981 to WGS 84 (1)' not in t.description:
                        raise SystemExit(f'PROJ picked another operation: {t.description}')
            else:
                for t in (fwd, inv):
                    if 'Nepal 1981 to WGS 84' in t.description:
                        raise SystemExit(f'"none" case went through a datum shift: {t.description}')
            forward = []
            for name, lon, lat in PLACES:
                if abs(lon - zone) > 4:
                    continue
                e, n = fwd.transform(lon, lat)
                forward.append({'name': name, 'lon': lon, 'lat': lat, 'e': round(e, 6), 'n': round(n, 6)})
            inverse = []
            points = GRID + [(c['e'], c['n']) for c in forward]
            for e, n in points:
                lon, lat = inv.transform(e, n)
                inverse.append({'e': e, 'n': n, 'lon': round(lon, 12), 'lat': round(lat, 12)})
            cases.append({'zone': zone, 'shift': shift, 'operation': fwd.description, 'forward': forward, 'inverse': inverse})

    out = {
        'generator': f'pyproj {pyproj.__version__}, PROJ {pyproj.proj_version_str}, EPSG {pyproj.database.get_database_metadata("EPSG.VERSION")}',
        'cases': cases,
    }
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reference.json')
    with open(path, 'w') as f:
        json.dump(out, f, indent=1)
        f.write('\n')
    print('wrote', path)


if __name__ == '__main__':
    main()

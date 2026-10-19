"""
Lays out lines of text in Inter Tight and prints their outlines as JSON, for
scripts/gen-og.mjs (`npm run og-image`), which rasterises them into the
link-preview image. Python only because fontTools is what can read the
variable woff2 and instance it at a weight; the drawing happens in Node.

Input (argv[1]): a JSON list of runs, each {"text", "wght", "tracking"} with
tracking in em. Output: {"upem", "runs": [{"advance", "contours"}]} in font
units, y up, each run starting at x = 0. Contours are polygons: curves are
flattened here, finely enough for a 1200 px image.

Kerning is the GPOS `kern` feature's pair adjustments (formats 1 and 2) —
enough for one line of Latin; there is no shaping beyond that.

Prerequisite: Python 3 with fontTools and brotli, as for `npm run display-font`.
"""

import json
import sys

from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

SOURCE = "scripts/fonts/inter-tight/InterTight-latin-wght.woff2"
STEPS = 16


class FlattenPen(BasePen):
    def __init__(self, glyph_set, dx):
        super().__init__(glyph_set)
        self.dx = dx
        self.contours = []

    def _point(self, p):
        return [round(p[0] + self.dx, 2), round(p[1], 2)]

    def _moveTo(self, p):
        self.contours.append([self._point(p)])

    def _lineTo(self, p):
        self.contours[-1].append(self._point(p))

    def _qCurveToOne(self, p1, p2):
        p0 = self._getCurrentPoint()
        for i in range(1, STEPS + 1):
            t = i / STEPS
            u = 1 - t
            self.contours[-1].append(self._point((
                u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
            )))

    def _curveToOne(self, p1, p2, p3):
        p0 = self._getCurrentPoint()
        for i in range(1, STEPS + 1):
            t = i / STEPS
            u = 1 - t
            self.contours[-1].append(self._point((
                u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
                u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1],
            )))

    def _closePath(self):
        pass

    def _endPath(self):
        pass


def pair_kerning(font):
    """kern(a, b) -> x-advance adjustment from GPOS pair positioning."""
    if "GPOS" not in font:
        return lambda a, b: 0
    gpos = font["GPOS"].table
    indices = sorted({i for record in gpos.FeatureList.FeatureRecord if record.FeatureTag == "kern" for i in record.Feature.LookupListIndex})
    subtables = []
    for index in indices:
        lookup = gpos.LookupList.Lookup[index]
        for subtable in lookup.SubTable:
            if lookup.LookupType == 9:
                subtable = subtable.ExtSubTable
            if getattr(subtable, "LookupType", 2) == 2:
                subtables.append(subtable)

    def x_advance(value):
        return (getattr(value, "XAdvance", 0) or 0) if value is not None else 0

    def kern(a, b):
        for subtable in subtables:
            glyphs = subtable.Coverage.glyphs
            if a not in glyphs:
                continue
            if subtable.Format == 1:
                for record in subtable.PairSet[glyphs.index(a)].PairValueRecord:
                    if record.SecondGlyph == b:
                        return x_advance(record.Value1)
            elif subtable.Format == 2:
                c1 = subtable.ClassDef1.classDefs.get(a, 0)
                c2 = subtable.ClassDef2.classDefs.get(b, 0)
                return x_advance(subtable.Class1Record[c1].Class2Record[c2].Value1)
        return 0

    return kern


def main() -> None:
    runs = json.loads(sys.argv[1])
    fonts = {}
    out = []
    upem = None
    for run in runs:
        wght = run["wght"]
        if wght not in fonts:
            font = instancer.instantiateVariableFont(TTFont(SOURCE), {"wght": wght})
            fonts[wght] = (font, font.getGlyphSet(), font.getBestCmap(), pair_kerning(font))
        font, glyph_set, cmap, kern = fonts[wght]
        upem = font["head"].unitsPerEm
        tracking = run.get("tracking", 0) * upem
        x = 0
        previous = None
        contours = []
        for char in run["text"]:
            name = cmap[ord(char)]
            if previous is not None:
                x += kern(previous, name) + tracking
            pen = FlattenPen(glyph_set, x)
            glyph_set[name].draw(pen)
            contours.extend(pen.contours)
            x += glyph_set[name].width
            previous = name
        out.append({"advance": x, "contours": contours})
    json.dump({"upem": upem, "runs": out}, sys.stdout)


if __name__ == "__main__":
    sys.exit(main())

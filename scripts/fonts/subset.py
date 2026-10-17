"""
Font half of `npm run icon-font` (scripts/icon-font.ts drives it).

  subset.py ligatures <full.woff2>
      Prints every ligature name the full font knows, one per line.
  subset.py subset <full.woff2> <out.woff2> <name> [<name> ...]
      Writes a WOFF2 that renders exactly those ligatures.

Material Symbols draws an icon when the GSUB `rlig` lookup turns the letters
of its name into one glyph. Subsetting by `--text` alone keeps nothing out:
every ligature whose letters survive is kept, and with a-z and _ surviving
that is all ~4,300 of them. So the ligature table is pruned to the wanted
names first, and only then does the subsetter take the closure.

The variable axes are pinned to what src/shell/theme.css asks for
(`'wght' 400, 'FILL' 0, 'GRAD' 0`); `opsz` stays variable so the browser's
automatic optical sizing still fits strokes to the 14-40 px the site uses.
If the CSS ever varies one of the pinned axes, unpin it in PINNED.

Prerequisite: Python 3 with fontTools and brotli (`pip install fonttools brotli`).
"""

import io
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

PINNED = {"wght": 400, "FILL": 0, "GRAD": 0}


def ligature_subtables(font):
    gsub = font["GSUB"].table
    for lookup in gsub.LookupList.Lookup:
        for table in lookup.SubTable:
            if lookup.LookupType == 7:
                table = table.ExtSubTable
            if table.LookupType == 4:
                yield table


def name_of(first, ligature, glyph_to_char):
    try:
        return "".join(glyph_to_char[g] for g in [first, *ligature.Component])
    except KeyError:
        return None


def ligature_names(font):
    glyph_to_char = {g: chr(u) for u, g in font.getBestCmap().items()}
    names = set()
    for table in ligature_subtables(font):
        for first, ligatures in table.ligatures.items():
            for ligature in ligatures:
                name = name_of(first, ligature, glyph_to_char)
                if name:
                    names.add(name)
    return names


def build(source, out, wanted):
    font = TTFont(source)
    known = ligature_names(font)
    missing = sorted(set(wanted) - known)
    if missing:
        sys.exit(f"not in the font: {', '.join(missing)}")

    font = instancer.instantiateVariableFont(font, PINNED)
    # Round-trip so the subsetter sees fully decompiled tables; the
    # instancer leaves gvar half lazy and the subsetter trips over it.
    buffer = io.BytesIO()
    font.save(buffer)
    buffer.seek(0)
    font = TTFont(buffer)

    glyph_to_char = {g: chr(u) for u, g in font.getBestCmap().items()}
    for table in ligature_subtables(font):
        for first in list(table.ligatures):
            kept = [
                lig
                for lig in table.ligatures[first]
                if name_of(first, lig, glyph_to_char) in wanted
            ]
            if kept:
                table.ligatures[first] = kept
            else:
                del table.ligatures[first]

    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["rlig", "rclt", "liga", "calt"]
    options.name_IDs = ["*"]  # keep the licence and copyright records
    options.notdef_outline = True
    options.hinting = False
    subsetter = subset.Subsetter(options)
    subsetter.populate(text="".join(sorted(set("".join(wanted)))))
    subsetter.subset(font)
    font.save(out)

    check = TTFont(out)
    got = ligature_names(check)
    if got != set(wanted):
        sys.exit(f"subset renders {sorted(got ^ set(wanted))} differently from the request")
    print(f"{out}: {len(got)} ligatures, {check['maxp'].numGlyphs} glyphs")


def main(argv):
    if len(argv) >= 2 and argv[0] == "ligatures":
        print("\n".join(sorted(ligature_names(TTFont(argv[1])))))
    elif len(argv) >= 4 and argv[0] == "subset":
        build(argv[1], argv[2], set(argv[3:]))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])

"""
Builds src/shell/InterTight-display.woff2, the display face for the landing
hero and the tool brands (`npm run display-font`; the build does not run it,
the output is committed).

Source: Inter Tight, Latin variable `wght` (via @fontsource-variable/inter-tight
5.3.0), SIL Open Font License 1.1 — see scripts/fonts/inter-tight/OFL.txt.

Only what the display text needs is kept: weights 600-900 (the axis stays
variable over that range) and printable ASCII plus a little punctuation. Body
text uses the system UI font, so nothing else is drawn in this face.

Prerequisite: Python 3 with fontTools and brotli (`pip install fonttools brotli`).
"""

import io
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

SOURCE = "scripts/fonts/inter-tight/InterTight-latin-wght.woff2"
OUT = "src/shell/InterTight-display.woff2"
WEIGHTS = (600, 900)
# Printable ASCII, plus the punctuation the hero and brands use.
TEXT = "".join(chr(c) for c in range(0x20, 0x7F)) + "·–—’‘“”…→×"


def main() -> None:
    font = TTFont(SOURCE)
    font = instancer.instantiateVariableFont(font, {"wght": WEIGHTS})
    options = subset.Options()
    options.layout_features = ["kern", "liga", "calt", "case", "tnum", "ss01"]
    options.flavor = "woff2"
    options.name_IDs = ["*"]
    subsetter = subset.Subsetter(options)
    subsetter.populate(text=TEXT)
    subsetter.subset(font)
    buffer = io.BytesIO()
    font.flavor = "woff2"
    font.save(buffer)
    with open(OUT, "wb") as out:
        out.write(buffer.getvalue())
    axis = next(a for a in font["fvar"].axes if a.axisTag == "wght")
    print(f"{OUT}: {len(font.getGlyphOrder())} glyphs, wght {axis.minValue:g}-{axis.maxValue:g}, {len(buffer.getvalue()) / 1024:.1f} KiB")


if __name__ == "__main__":
    sys.exit(main())

"""Writes entities.dxf and entities.expected.json for dxf/read.test.ts.

The drawing exercises what the reader must place correctly: bulges, OCS
extrusion, nested and arrayed block references with layer-0 / BYBLOCK
inheritance, hatch boundaries with a hole, splines, text, plus entities the
reader must leave out (hidden layer, paper space, dimensions).

Expected values come from ezdxf itself: per-layer extents of the exploded
geometry (ezdxf.bbox), so the reader is checked against an independent
implementation. Run with ezdxf >= 1.4 (pip install ezdxf), then commit both
outputs:  python3 generate.py
"""
import json
import os

import ezdxf
from ezdxf import bbox
from ezdxf.math import Vec3

here = os.path.dirname(os.path.abspath(__file__))
doc = ezdxf.new("R2018", setup=True)
doc.header["$INSUNITS"] = 6
msp = doc.modelspace()

doc.layers.add("Walls", color=1)
doc.layers.add("Arcs", color=5)
doc.layers.add("Curves", color=6)
doc.layers.add("Trees", color=3)
doc.layers.add("Trunks", color=30)
doc.layers.add("Grove", color=4)
doc.layers.add("Array", color=2)
doc.layers.add("Hatch", color=8)
doc.layers.add("Mirror", color=1)
doc.layers.add("Faces", color=9)
doc.layers.add("Notes", color=7)
hidden = doc.layers.add("Hidden", color=1)
hidden.off()

msp.add_line((0, 0), (40, 0), dxfattribs={"layer": "Walls"})
# A 20 x 10 room whose right side bulges out into a half circle.
msp.add_lwpolyline([(0, 0, 0), (20, 0, 1), (20, 10, 0), (0, 10, 0)], format="xyb", close=True, dxfattribs={"layer": "Walls"})

msp.add_circle((100, 100), 10, dxfattribs={"layer": "Arcs"})
msp.add_arc((0, 50), 5, 0, 90, dxfattribs={"layer": "Arcs"})
# Mirrored circle: centre (50, 0) in an OCS whose X runs along -X.
msp.add_circle((50, 0), 4, dxfattribs={"layer": "Mirror", "extrusion": (0, 0, -1)})

msp.add_ellipse((200, 0), major_axis=(20, 0), ratio=0.5, dxfattribs={"layer": "Curves"})
msp.add_spline_control_frame([(300, 0), (310, 20), (330, -10), (350, 15), (360, 0)], degree=3, dxfattribs={"layer": "Curves"})
msp.add_open_spline([(400, 0, 0), (410, 30, 0), (430, -20, 0), (450, 0, 0)], degree=3, dxfattribs={"layer": "Curves"})

msp.add_text("Hello", dxfattribs={"layer": "Notes", "height": 2.5}).set_placement((10, 10))
msp.add_mtext("{\\fArial|b1;Bold} line\\Psecond line", dxfattribs={"layer": "Notes", "char_height": 2}).set_location((20, 20))

tree = doc.blocks.new("TREE", base_point=(1, 1))
tree.add_circle((1, 1), 1, dxfattribs={"layer": "0", "color": 0})
tree.add_line((1, 1), (3, 1), dxfattribs={"layer": "Trunks"})

grove = doc.blocks.new("GROVE")
grove.add_blockref("TREE", (0, 0), dxfattribs={"layer": "0"})
grove.add_blockref("TREE", (10, 0), dxfattribs={"layer": "0", "xscale": 0.5, "yscale": 0.5})

msp.add_blockref("TREE", (500, 500), dxfattribs={"layer": "Trees", "color": 3, "xscale": 2, "yscale": 2, "rotation": 90})
msp.add_blockref("GROVE", (1000, 0), dxfattribs={"layer": "Grove", "rotation": 45})
minsert = msp.add_blockref("TREE", (700, 700), dxfattribs={"layer": "Array", "rotation": 30})
minsert.grid(size=(2, 3), spacing=(10, 20))

hatch = msp.add_hatch(color=8, dxfattribs={"layer": "Hatch"})
hatch.paths.add_polyline_path([(300, 300), (310, 300), (310, 310), (300, 310)], is_closed=True, flags=1)
hatch.paths.add_polyline_path([(303, 303), (307, 303), (307, 307), (303, 307)], is_closed=True, flags=16)
edge = hatch.paths.add_edge_path(flags=1)
edge.add_line((320, 300), (330, 300))
edge.add_arc((330, 305), 5, -90, 90, ccw=True)
edge.add_line((330, 310), (320, 310))
edge.add_line((320, 310), (320, 300))

msp.add_3dface([(600, 0, 0), (610, 0, 0), (610, 10, 5), (600, 10, 5)], dxfattribs={"layer": "Faces"})
msp.add_line((0, 0), (999999, 999999), dxfattribs={"layer": "Hidden"})
dim = msp.add_linear_dim(base=(0, -5), p1=(0, 0), p2=(40, 0), dxfattribs={"layer": "Walls"})
dim.render()
doc.layouts.get("Layout1").add_line((0, 0), (5000, 5000), dxfattribs={"layer": "Walls"})

doc.saveas(os.path.join(here, "entities.dxf"))

# Expected: per-layer extents of everything drawable, blocks exploded.
reread = ezdxf.readfile(os.path.join(here, "entities.dxf"))
layers = {}


def collect(entity, inherited=None):
    """inherited: the layer a layer-0 entity takes on inside a block."""
    t = entity.dxftype()
    layer = inherited if entity.dxf.layer == "0" and inherited else entity.dxf.layer
    if t == "INSERT":
        for sub in entity.virtual_entities():
            collect(sub, layer)
        return
    if t in ("DIMENSION", "TEXT", "MTEXT"):
        return
    if layer == "Hidden":
        return
    box = bbox.extents([entity], fast=False)
    if not box.has_data:
        return
    prev = layers.get(layer)
    layers[layer] = box if prev is None else prev.union(box)


for e in reread.modelspace():
    if e.dxftype() == "INSERT" and e.mcount > 1:
        for one in e.multi_insert():
            collect(one)
    else:
        collect(e)

expected = {
    layer: [round(v, 6) for v in (*box.extmin.vec2, *box.extmax.vec2)]
    for layer, box in sorted(layers.items())
}
with open(os.path.join(here, "entities.expected.json"), "w") as f:
    json.dump(expected, f, indent=1)
    f.write("\n")
print(json.dumps(expected))

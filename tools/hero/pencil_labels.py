#!/usr/bin/env python3
"""Place names pencilled onto the hero sheet (goes with the paper look).

    python3 tools/hero/pencil_labels.py index.html de/index.html   # needs fontTools, pyproj

Writes an SVG (same 10 x 5 km frame as the hero map, viewBox in metres) between
the <!-- build:hero-pencil --> markers, right after the hero map. Positions are
OpenStreetMap place nodes (fetched 2026-10-10); names are proper nouns, the same
in both languages. The handwriting is Caveat (SIL OFL, tools/hero/fonts/),
converted to outlines here, so no font is loaded on the site: each glyph is a
<path> in <defs>, reused with <use>. Colour (--pencil) and the graphite grain
filter live in CSS / the SVG itself.
"""
import math
import random
import re
import sys
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from pyproj import Transformer

FONT = Path(__file__).with_name("fonts") / "Caveat-wght.ttf"
WEIGHT = 520
X0, Y1 = 408660, 5319200          # hero bbox west / north (UTM 32N), see hero-contours.json
# name, lat, lon (OSM place node), size in m (~px x 6), side of the mark, extra class
PLACES = [
    ("Freiburg", 47.99609, 7.84940, 150, "l", "pc-city"),
    ("Rieselfeld", 47.99947, 7.79143, 150, "r", "pc-wide"),
    ("Lehen", 48.01677, 7.80227, 150, "r", "pc-wide"),
    ("Waldsee", 47.98813, 7.88440, 150, "r", "pc-wide"),
]

rnd = random.Random(7)
font = instantiateVariableFont(TTFont(FONT), {"wght": WEIGHT})
gs, cmap, hmtx = font.getGlyphSet(), font.getBestCmap(), font["hmtx"]
UPM = font["head"].unitsPerEm
to_utm = Transformer.from_crs(4326, 32632, always_xy=True)


def glyph_path(name):
    pen = SVGPathPen(gs, ntos=lambda v: str(round(v)))
    gs[name].draw(TransformPen(pen, (0.1, 0, 0, -0.1, 0, 0)))   # 1/100 em, font y up -> svg y down
    return pen.getCommands()


def ring(cx, cy, r):
    """A quick pencil circle: not round, not closed, a little overshoot."""
    a0 = rnd.uniform(0, 2 * math.pi)
    pts = []
    for i in range(23):
        a = a0 + i / 20 * 2 * math.pi
        rr = r * (1 + 0.12 * math.sin(3 * a + a0) + rnd.uniform(-0.04, 0.04))
        pts.append(f"{cx + rr * math.cos(a):.0f} {cy + rr * math.sin(a) * 0.9:.0f}")
    return "M" + " L".join(pts)


used, labels = {}, []
for name, lat, lon, size, side, cls in PLACES:
    e, n = to_utm.transform(lon, lat)
    x, y = e - X0, Y1 - n
    s = size / UPM
    s10 = s * 10                                           # glyph paths are in 1/100 em
    glyphs, pen_x = [], 0
    for ch in name:
        g = cmap[ord(ch)]
        gid = used.setdefault(g, f"pc{len(used)}")
        glyphs.append((gid, pen_x))
        pen_x += hmtx[g][0]
    width = pen_x * s
    gap = size * 0.5
    tx = x + gap if side == "r" else x - gap - width
    ty = y + size * 0.22                                   # baseline: x-height centred on the mark
    rot = rnd.uniform(-4, 3)
    uses = "".join(f'<use href="#{gid}" x="{gx / 10:.0f}"/>' for gid, gx in glyphs)
    r = size * (0.3 if cls == "pc-city" else 0.24)
    labels.append(
        f'<g class="{("pc " + cls).strip()}">'
        f'<path class="pc-line" d="{ring(x, y, r)}"/><circle cx="{x:.0f}" cy="{y:.0f}" r="{size * 0.06:.0f}"/>'
        f'<g transform="translate({tx:.0f} {ty:.0f}) rotate({rot:.1f}) scale({s10:.4f})">{uses}</g>'
        "</g>"
    )

defs = "".join(f'<path id="{gid}" d="{glyph_path(g)}"/>' for g, gid in used.items())
svg = (
    '<div class="pencil-box"><svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="pencil" '
    'viewBox="0 0 10000 5000" preserveAspectRatio="xMidYMid slice">'
    '<defs><filter id="pc-graphite" x="-5%" y="-30%" width="110%" height="160%" filterUnits="objectBoundingBox">'
    '<feTurbulence type="fractalNoise" baseFrequency=".11" numOctaves="2" seed="4" result="n"/>'
    '<feColorMatrix in="n" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -2 1.68" result="grain"/>'
    '<feComposite in="SourceGraphic" in2="grain" operator="in" result="g"/>'
    '<feDisplacementMap in="g" in2="n" scale="7" xChannelSelector="R" yChannelSelector="G"/>'
    f"</filter>{defs}</defs>"
    f'<g filter="url(#pc-graphite)">{"".join(labels)}</g></svg></div>'
)

for page in sys.argv[1:]:
    p = Path(page)
    html = p.read_text()
    if "<!-- build:hero-pencil -->" not in html:
        html = html.replace("<!-- /build:hero-map -->",
                            "<!-- /build:hero-map --><!-- build:hero-pencil --><!-- /build:hero-pencil -->", 1)
    html = re.sub(r"<!-- build:hero-pencil -->.*?<!-- /build:hero-pencil -->",
                  lambda m: f"<!-- build:hero-pencil -->{svg}<!-- /build:hero-pencil -->", html, flags=re.S)
    p.write_text(html)
    print(f"{page}: {len(svg) / 1024:.1f} KB of pencil labels ({len(used)} glyphs)")

"""Build the "From orbit to drone" resolution explorer views.

The same OSM building footprints of Ebringen (tools/layers/work/village.json, fetched by
build_layers.py) seen at three platforms' ground resolution and footprint:

  satellite  1600 x 1000 m, 30 m pixels (Landsat): building coverage per pixel
  aerial      400 x  250 m, 20 cm (orthophoto): footprints, sub-screen-pixel resolution
  drone        80 x   50 m, ~2 cm (drone):        a few buildings, sharp outlines

Each view also carries the next view's footprint (dashed, accent). The SVGs are written
between <!-- build:explorer-NAME --> markers in index.html and de/index.html; colours
come from the page CSS (.ex-*), so they follow the theme.

Run from the repo root after build_layers.py: python3 tools/layers/build_explorer.py
"""

import json
import re
from pathlib import Path

import numpy as np
from osgeo import osr
from PIL import Image, ImageDraw

osr.UseExceptions()

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(__file__).resolve().parent / "work/village.json"

CENTER = (7.7760, 47.9575)  # Ebringen
VIEWS = [  # name, width (m), cell (m) for the satellite raster
    ("satellite", 1600, 30),
    ("aerial", 400, None),
    ("drone", 80, None),
]
ASPECT = 16 / 10


def buildings():
    wgs = osr.SpatialReference()
    wgs.ImportFromEPSG(4326)
    wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    utm = osr.SpatialReference()
    utm.ImportFromEPSG(32632)
    ct = osr.CoordinateTransformation(wgs, utm)
    polys = []
    for el in json.loads(DATA.read_text())["elements"]:
        if el.get("type") == "way" and "geometry" in el:
            pts = np.array([ct.TransformPoint(g["lon"], g["lat"])[:2] for g in el["geometry"]])
            if len(pts) > 1 and (pts[0] == pts[-1]).all():
                pts = pts[:-1]
            if len(pts) >= 3:
                polys.append(pts)
    return polys, ct.TransformPoint(*CENTER)[:2]


def area(p):
    x, y = p[:, 0], p[:, 1]
    return 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))


def pick_drone_center(polys, c):
    """Centre of the densest 80 x 50 m window near the village centre."""
    best, best_score = c, -1
    for dx in range(-150, 151, 10):
        for dy in range(-100, 101, 10):
            x, y = c[0] + dx, c[1] + dy
            score = sum(area(p) for p in polys
                        if abs(p[:, 0].mean() - x) < 34 and abs(p[:, 1].mean() - y) < 19)
            if score > best_score:
                best, best_score = (x, y), score
    return best


def outline_svg(polys, cx, cy, w, h, scale):
    """Footprints clipped to the window, in a viewBox of w*scale x h*scale units."""
    x0, y1 = cx - w / 2, cy + h / 2
    d = []
    for p in polys:
        if p[:, 0].max() < x0 or p[:, 0].min() > x0 + w or p[:, 1].max() < y1 - h or p[:, 1].min() > y1:
            continue
        q = np.column_stack([(p[:, 0] - x0) * scale, (y1 - p[:, 1]) * scale])
        d.append("M" + "L".join(f"{x:.0f} {y:.0f}" for x, y in q) + "Z")
    return "".join(d)


def raster_svg(polys, cx, cy, w, h, cell):
    """Fraction of each cell covered by buildings, quantised to four levels."""
    res = 1  # rasterise footprints at 1 m first
    x0, y1 = cx - w / 2, cy + h / 2
    img = Image.new("L", (w, h), 0)
    dr = ImageDraw.Draw(img)
    for p in polys:
        dr.polygon([((x - x0) / res, (y1 - y) / res) for x, y in p], fill=255)
    a = np.asarray(img, dtype=float) / 255
    nx, ny = w // cell, h // cell
    cov = a[: ny * cell, : nx * cell].reshape(ny, cell, nx, cell).mean(axis=(1, 3))
    levels = {1: [], 2: [], 3: [], 4: []}
    for j in range(ny):
        for i in range(nx):
            v = cov[j, i]
            if v > 0.02:
                levels[min(4, 1 + int(v * 8))].append(f"M{i} {j}h1v1h-1z")
    return nx, ny, levels


def footprint_rect(cx, cy, w, h, ncx, ncy, nw, nh, scale):
    x = (ncx - nw / 2 - (cx - w / 2)) * scale
    y = ((cy + h / 2) - (ncy + nh / 2)) * scale
    return f'<rect class="ex-next" x="{x:.1f}" y="{y:.1f}" width="{nw * scale:.1f}" height="{nh * scale:.1f}"/>'


def main():
    polys, c = buildings()
    dcx, dcy = pick_drone_center(polys, c)
    centers = {"satellite": c, "aerial": c, "drone": (dcx, dcy)}
    blocks = {}
    for k, (name, w, cell) in enumerate(VIEWS):
        h = round(w / ASPECT)
        cx, cy = centers[name]
        nxt = VIEWS[k + 1] if k + 1 < len(VIEWS) else None
        if name == "satellite":
            nx, ny, levels = raster_svg(polys, cx, cy, w, h, cell)
            body = "".join(f'<path class="ex-px ex-px{lv}" d="{"".join(cells)}"/>' for lv, cells in levels.items() if cells)
            scale, vb = nx / w, f"0 0 {nx} {ny}"
        else:
            scale = 1000 / w  # 1000 units across
            body = f'<path class="ex-bldg" d="{outline_svg(polys, cx, cy, w, h, scale)}"/>'
            vb = f"0 0 1000 {round(1000 / ASPECT)}"
        if nxt:
            nw = nxt[1]
            ncx, ncy = centers[nxt[0]]
            body += footprint_rect(cx, cy, w, h, ncx, ncy, nw, round(nw / ASPECT), scale)
        blocks[name] = (f'<svg class="ex-svg" viewBox="{vb}" preserveAspectRatio="xMidYMid meet" '
                        f'aria-hidden="true" focusable="false">{body}</svg>')
        print(f"{name:9} {w} m wide, {len(blocks[name]) // 1024} KB")

    for path in ("index.html", "de/index.html"):
        page = ROOT / path
        s = page.read_text()
        for name, svg in blocks.items():
            s, n = re.subn(rf"(<!-- build:explorer-{name} -->).*?(<!-- /build:explorer-{name} -->)",
                           lambda m: m.group(1) + svg + m.group(2), s, flags=re.S)
            if not n:
                raise SystemExit(f"no build:explorer-{name} marker in {path}")
        page.write_text(s)
        print("updated", path)


if __name__ == "__main__":
    main()

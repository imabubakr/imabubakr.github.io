"""Build the data and the no-JS fallback for the "From orbit to drone" explorer.

Writes assets/layers/explorer.json: OSM building footprints of Ebringen in a
1600 x 1000 m box (metres from the top-left, y down, delta-encoded integers) plus a
default descent point (the densest 80 x 50 m spot). assets/js/explorer.js draws them
at any altitude: coarse pixels from orbit, sharp outlines from a drone.

Also writes a static satellite view (30 m pixels) between <!-- build:explorer-fallback -->
markers in index.html and de/index.html, shown until the script takes over.

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
OUT = ROOT / "assets/layers/explorer.json"

CENTER = (7.7760, 47.9575)  # Ebringen
W, H = 1600, 1000  # metres


def buildings():
    wgs = osr.SpatialReference()
    wgs.ImportFromEPSG(4326)
    wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    utm = osr.SpatialReference()
    utm.ImportFromEPSG(32632)
    ct = osr.CoordinateTransformation(wgs, utm)
    cx, cy = ct.TransformPoint(*CENTER)[:2]
    x0, y1 = cx - W / 2, cy + H / 2
    polys = []
    for el in json.loads(DATA.read_text())["elements"]:
        if el.get("type") != "way" or "geometry" not in el:
            continue
        pts = np.array([ct.TransformPoint(g["lon"], g["lat"])[:2] for g in el["geometry"]])
        if len(pts) > 1 and (pts[0] == pts[-1]).all():
            pts = pts[:-1]
        pts = np.column_stack([pts[:, 0] - x0, y1 - pts[:, 1]])
        if len(pts) < 3 or pts[:, 0].max() < 0 or pts[:, 0].min() > W or pts[:, 1].max() < 0 or pts[:, 1].min() > H:
            continue
        q = np.round(pts).astype(int)
        q = q[np.r_[True, (np.diff(q, axis=0) != 0).any(axis=1)]]
        if len(q) >= 3:
            polys.append(q)
    return polys


def area(p):
    x, y = p[:, 0], p[:, 1]
    return 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))


def densest_spot(polys):
    """Centre of the 80 x 50 m window with the most buildings (count, not roof area,
    so the default drone view shows several houses rather than one large hall)."""
    cents = np.array([p.mean(axis=0) for p in polys])
    areas = np.array([1.0 for p in polys])
    best, score = (W / 2, H / 2), -1
    for x in range(400, 1201, 10):
        for y in range(300, 701, 10):
            m = (abs(cents[:, 0] - x) < 34) & (abs(cents[:, 1] - y) < 19)
            s = areas[m].sum()
            if s > score:
                best, score = (x, y), s
    return best


def fallback_svg(polys, cell=30):
    img = Image.new("L", (W, H), 0)
    dr = ImageDraw.Draw(img)
    for p in polys:
        dr.polygon([tuple(v) for v in p], fill=255)
    a = np.asarray(img, dtype=float) / 255
    nx, ny = W // cell, H // cell
    cov = a[: ny * cell, : nx * cell].reshape(ny, cell, nx, cell).mean(axis=(1, 3))
    levels = {1: [], 2: [], 3: [], 4: []}
    for j in range(ny):
        for i in range(nx):
            if cov[j, i] > 0.02:
                levels[min(4, 1 + int(cov[j, i] * 8))].append(f"M{i} {j}h1v1h-1z")
    body = "".join(f'<path class="ex-px ex-px{lv}" d="{"".join(c)}"/>' for lv, c in levels.items() if c)
    return (f'<svg class="ex-svg" viewBox="0 0 {nx} {ny}" preserveAspectRatio="xMidYMid slice" '
            f'aria-hidden="true" focusable="false">{body}</svg>')


def main():
    polys = buildings()
    enc = []
    for p in polys:
        d = np.vstack([p[:1], np.diff(p, axis=0)]).ravel()
        enc.append(d.tolist())
    data = {"w": W, "h": H, "focus": densest_spot(polys), "b": enc,
            "credit": "Building footprints © OpenStreetMap contributors (ODbL)"}
    OUT.write_text(json.dumps(data, separators=(",", ":")))
    print(f"{len(polys)} buildings, {OUT.stat().st_size // 1024} KB, focus {data['focus']}")

    svg = fallback_svg(polys)
    for path in ("index.html", "de/index.html"):
        page = ROOT / path
        s = page.read_text()
        s, n = re.subn(r"(<!-- build:explorer-fallback -->).*?(<!-- /build:explorer-fallback -->)",
                       lambda m: m.group(1) + svg + m.group(2), s, flags=re.S)
        if not n:
            raise SystemExit(f"no build:explorer-fallback marker in {path}")
        page.write_text(s)
        print("updated", path)


if __name__ == "__main__":
    main()

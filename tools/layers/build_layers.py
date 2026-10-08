"""Build the page background: building outlines of a village (assets/layers/village.svg).

Outlines only (no fill), from OpenStreetMap. The page paints the SVG as a mask with
var(--contour), fixed behind everything below the hero, so it follows light/dark mode.
The frame is 16:10 around the village centre; phones see the centre (cover crop).

To use another village, change VILLAGE (centre lon/lat, frame width in metres) and
delete tools/layers/work/village.json so the buildings are fetched again (needs network).

Data credit required on the page: "© OpenStreetMap contributors" (ODbL).
Run from the repo root: python3 tools/layers/build_layers.py
"""

import json
import subprocess
import time
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
from osgeo import osr

osr.UseExceptions()

ROOT = Path(__file__).resolve().parents[2]
WORK = Path(__file__).resolve().parent / "work"
OUT = ROOT / "assets/layers"

VILLAGE = {"name": "Ebringen", "lon": 7.7760, "lat": 47.9575, "width_m": 2000}
ASPECT = 16 / 10
STROKE_M = 1.1  # outline width in metres (about 1 px on a 1440 px wide screen)
ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://gall.openstreetmap.de/api/interpreter"]


def fetch(bbox):
    cache = WORK / "village.json"
    if cache.exists():
        return json.loads(cache.read_text())
    WORK.mkdir(parents=True, exist_ok=True)
    s, w, n, e = bbox
    query = f'[out:json][timeout:90];way["building"]({s},{w},{n},{e});out geom;'
    for attempt in range(6):
        url = ENDPOINTS[attempt % len(ENDPOINTS)]
        req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": query}).encode(),
                                     headers={"User-Agent": "imabubakr.github.io-layer-builder/1.0 (personal website)"})
        try:
            data = json.loads(urllib.request.urlopen(req, timeout=150).read())
            cache.write_text(json.dumps(data))
            return data
        except (ValueError, OSError):
            time.sleep(15)  # Overpass is often busy; try the other server
    raise SystemExit("Overpass did not answer; try again later")


def simplify(pts):
    """Whole metres, no repeated or (nearly) collinear vertices."""
    pts = np.round(pts).astype(int)
    keep = [pts[0]]
    for p in pts[1:]:
        if (p != keep[-1]).any():
            keep.append(p)
    out = []
    n = len(keep)
    for i in range(n):
        a, b, c = keep[i - 1], keep[i], keep[(i + 1) % n]
        if abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) > 1:
            out.append(b)
    return out


def main():
    wgs = osr.SpatialReference()
    wgs.ImportFromEPSG(4326)
    wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    utm = osr.SpatialReference()
    utm.ImportFromEPSG(32632)
    fwd = osr.CoordinateTransformation(wgs, utm)
    inv = osr.CoordinateTransformation(utm, wgs)

    width = VILLAGE["width_m"]
    height = round(width / ASPECT)
    cx, cy = fwd.TransformPoint(VILLAGE["lon"], VILLAGE["lat"])[:2]
    x0, y1 = cx - width / 2, cy + height / 2
    (w, s), (e, n) = (inv.TransformPoint(x0 - 50, cy - height / 2 - 50)[:2],
                      inv.TransformPoint(cx + width / 2 + 50, y1 + 50)[:2])

    paths = []
    for el in fetch((s, w, n, e))["elements"]:
        if el.get("type") != "way" or "geometry" not in el:
            continue
        pts = np.array([fwd.TransformPoint(g["lon"], g["lat"])[:2] for g in el["geometry"]])
        pts[:, 0] -= x0
        pts[:, 1] = y1 - pts[:, 1]  # SVG y points down
        if pts[:, 0].max() < 0 or pts[:, 0].min() > width or pts[:, 1].max() < 0 or pts[:, 1].min() > height:
            continue
        simple = simplify(pts)
        if len(simple) >= 3:
            paths.append("M" + "L".join(f"{x} {y}" for x, y in simple) + "Z")

    OUT.mkdir(parents=True, exist_ok=True)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" preserveAspectRatio="xMidYMid slice">'
           f'<path d="{"".join(paths)}" fill="none" stroke="#000" stroke-width="{STROKE_M}" stroke-linejoin="round"/></svg>')
    target = OUT / "village.svg"
    target.write_text(svg)
    svgo = ROOT / "tools/contours/node_modules/.bin/svgo"
    if svgo.exists():
        subprocess.run([str(svgo), "-q", "--config", str(ROOT / "tools/contours/svgo.config.mjs"),
                        str(target), "-o", str(target)], check=True)
    print(f"{VILLAGE['name']}: {len(paths)} buildings, {width} x {height} m, {target.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()

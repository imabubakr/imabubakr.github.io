"""Build the faint section-background "data layers" (assets/layers/).

  buildings.svg   OSM building footprints, central Freiburg (behind the CV heading)
  detections.svg  bounding boxes around the larger of those buildings, labelled
                  "building" with no scores: a design motif, not model output
                  (behind the Visualizations heading, over a fainter buildings.svg)
  pointcloud.webp oblique view of points sampled from the hero DEM, Black Forest
                  edge east of Freiburg (behind the About heading)

All three are single-colour masks: the page paints them with var(--contour), so
they follow light/dark mode. Strips are 4:1 and centred on the Freiburg Münster.

Inputs:
  tools/layers/work/osm_buildings.json  Overpass JSON; fetched if missing (needs network):
      [out:json];way["building"](47.9906,7.8247,48.0006,7.8797);out geom;
  tools/contours/work/dem.tif           written by tools/contours/make_contours.sh

Data credit required on the page: "© OpenStreetMap contributors" (ODbL).
Run from the repo root: python3 tools/layers/build_layers.py
"""

import json
import math
import random
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
from osgeo import gdal, osr
from PIL import Image, ImageDraw

gdal.UseExceptions()
osr.UseExceptions()

ROOT = Path(__file__).resolve().parents[2]
WORK = Path(__file__).resolve().parent / "work"
OUT = ROOT / "assets/layers"
OSM = WORK / "osm_buildings.json"
DEM = ROOT / "tools/contours/work/dem.tif"

CENTER = (7.8522, 47.9956)  # Freiburg Münster
STRIP_W, STRIP_H = 4000, 1000  # metres, 4:1
QUERY = '[out:json][timeout:90];way["building"](47.9906,7.8247,48.0006,7.8797);out geom;'


def fetch_osm():
    if OSM.exists():
        return json.loads(OSM.read_text())
    WORK.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(
        "https://overpass-api.de/api/interpreter",
        data=urllib.parse.urlencode({"data": QUERY}).encode(),
        headers={"User-Agent": "imabubakr.github.io-layer-builder/1.0 (personal website)"},
    )
    OSM.write_bytes(urllib.request.urlopen(req, timeout=180).read())
    return json.loads(OSM.read_text())


def utm():
    wgs = osr.SpatialReference()
    wgs.ImportFromEPSG(4326)
    wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    dst = osr.SpatialReference()
    dst.ImportFromEPSG(32632)
    return osr.CoordinateTransformation(wgs, dst)


def area(pts):
    x, y = pts[:, 0], pts[:, 1]
    return 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))


def simplify(pts):
    """Integer metres, no repeated or (nearly) collinear vertices."""
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


def buildings_in_strip():
    ct = utm()
    cx, cy = ct.TransformPoint(*CENTER)[:2]
    x0, y1 = cx - STRIP_W / 2, cy + STRIP_H / 2
    polys = []
    for el in fetch_osm()["elements"]:
        if el.get("type") != "way" or "geometry" not in el:
            continue
        pts = np.array([ct.TransformPoint(g["lon"], g["lat"])[:2] for g in el["geometry"]])
        pts[:, 0] -= x0
        pts[:, 1] = y1 - pts[:, 1]  # SVG y points down
        if pts[:, 0].max() < 0 or pts[:, 0].min() > STRIP_W or pts[:, 1].max() < 0 or pts[:, 1].min() > STRIP_H:
            continue
        if area(pts) < 25:
            continue
        simple = simplify(pts)
        if len(simple) >= 3:
            polys.append((area(pts), simple))
    return polys


def svg(body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {STRIP_W} {STRIP_H}" '
            f'preserveAspectRatio="xMidYMid slice">{body}</svg>')


def path_d(simple):
    return "M" + "L".join(f"{x} {y}" for x, y in simple) + "Z"


def write_buildings(polys):
    d = "".join(path_d(p) for _, p in polys)
    (OUT / "buildings.svg").write_text(svg(f'<path d="{d}"/>'))
    return len(polys)


def write_detections(polys):
    rnd = random.Random(7)
    big = [p for a, p in polys if a > 600]
    rnd.shuffle(big)
    boxes, taken = [], []
    for p in big:
        xs, ys = [q[0] for q in p], [q[1] for q in p]
        x0, y0, x1, y1 = min(xs) - 4, min(ys) - 4, max(xs) + 4, max(ys) + 4
        if x0 < 20 or y0 < 40 or x1 > STRIP_W - 20 or y1 > STRIP_H - 20:
            continue
        # keep boxes apart so labels stay readable
        if any(not (x1 + 60 < a or x0 - 60 > c or y1 + 60 < b or y0 - 60 > d) for a, b, c, d in taken):
            continue
        taken.append((x0, y0, x1, y1))
        boxes.append(
            f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}"/>'
            f'<text x="{x0}" y="{y0 - 7}">building</text>'
        )
        if len(boxes) >= 34:
            break
    # Boxes and labels only: the page draws buildings.svg (already cached from the CV)
    # faintly underneath, so the footprints aren't shipped twice.
    rects = "".join(b.split("<text")[0] for b in boxes)
    labels = "".join("<text" + b.split("<text")[1] for b in boxes)
    body = (f'<g fill="none" stroke="#000" stroke-width="3">{rects}</g>'
            f'<g font-family="ui-monospace,Menlo,monospace" font-size="26">{labels}</g>')
    (OUT / "detections.svg").write_text(svg(body))
    return len(boxes)


def write_pointcloud():
    ds = gdal.Open(str(DEM))
    arr = ds.GetRasterBand(1).ReadAsArray().astype(float)
    gt = ds.GetGeoTransform()
    # Black Forest edge east of the city: 4 km x 2 km window
    e0, n0, w, h = 414300, 5315600, 4000, 2000
    W, H = 2000, 500
    img = Image.new("LA", (W, H), (255, 0))
    draw = ImageDraw.Draw(img)
    rnd = np.random.default_rng(3)
    n = 14000
    xs = rnd.uniform(0, w, n)
    ys = rnd.uniform(0, h, n)
    cols = ((e0 + xs - gt[0]) / gt[1]).astype(int)
    rows = ((n0 + ys - gt[3]) / gt[5]).astype(int)
    ok = (cols >= 0) & (cols < arr.shape[1]) & (rows >= 0) & (rows < arr.shape[0])
    xs, ys, z = xs[ok], ys[ok], arr[rows[ok], cols[ok]]
    zmin, zmax = z.min(), z.max()
    order = np.argsort(-ys)  # far (north) first
    for i in order:
        # oblique view from the south: depth compresses y, elevation lifts points
        sx = xs[i] / w * W
        sy = H - 30 - ys[i] / h * 170 - (z[i] - zmin) * 0.55
        t = (z[i] - zmin) / (zmax - zmin)
        a = int(90 + 165 * t)
        r = 1.6 + 0.6 * (1 - ys[i] / h)
        draw.ellipse((sx - r, sy - r, sx + r, sy + r), fill=(255, a))
    img.save(OUT / "pointcloud.webp", lossless=False, quality=70, method=6)
    return int(ok.sum())


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    polys = buildings_in_strip()
    print("buildings:", write_buildings(polys))
    print("detection boxes:", write_detections(polys))
    print("point-cloud points:", write_pointcloud())
    svgo = ROOT / "tools/contours/node_modules/.bin/svgo"
    if svgo.exists():
        import subprocess
        for name in ("buildings.svg", "detections.svg"):
            subprocess.run([str(svgo), "-q", "--config", str(ROOT / "tools/contours/svgo.config.mjs"),
                            str(OUT / name), "-o", str(OUT / name)], check=True)
    for f in sorted(OUT.iterdir()):
        print(f"  {f.name}: {f.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()

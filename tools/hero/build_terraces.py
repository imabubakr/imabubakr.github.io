"""Terrace polygons for the hero "rise" effect: one filled layer per 10 m
contour level from the hero DEM (assets/topo/hero-contours-dem.bin, 200 x 100
cells of 50 m), smoothed and simplified, in map metres (x east, y down, the SVG's
viewBox 0..10000 x 0..5000).

    ~/miniforge3/envs/geoai/bin/python tools/hero/build_terraces.py
Writes assets/topo/hero-terraces.json.
"""
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from scipy import ndimage
from shapely.geometry import Polygon
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
meta = json.loads((ROOT / "assets/topo/hero-contours.json").read_text())
C, R = meta["grid"]["cols"], meta["grid"]["rows"]
dem = np.fromfile(ROOT / "assets/topo" / meta["grid"]["file"], "<i2").reshape(R, C).astype(float)
UP = 4
z = ndimage.zoom(ndimage.gaussian_filter(dem, 0.8), UP, order=3)
cell = 50.0 / UP
xs = (np.arange(z.shape[1]) + 0.5) * cell
ys = (np.arange(z.shape[0]) + 0.5) * cell
lo = int(np.floor(z.min() / 10) * 10) + 10
hi = int(np.floor(z.max() / 10) * 10)
levels = []
fig = plt.figure()
for lev in range(lo, hi + 1, 10):
    cs = plt.contourf(xs, ys, z, levels=[lev, z.max() + 1])
    polys = []
    for path in cs.get_paths():
        for poly in path.to_polygons():
            if len(poly) >= 4:
                polys.append(Polygon(poly))
    plt.clf()
    if not polys:
        continue
    # outer rings and holes come as separate rings: rebuild with even-odd via symmetric difference
    geom = polys[0]
    for p in polys[1:]:
        geom = geom.symmetric_difference(p)
    geom = geom.buffer(0).simplify(12)
    rings = []
    for g in getattr(geom, "geoms", [geom]):
        if g.is_empty or g.area < 2000:
            continue
        rings.append([round(v) for xy in g.exterior.coords for v in xy])
        for h in g.interiors:
            rings.append([round(v) for xy in h.coords for v in xy])
    if rings:
        levels.append({"z": lev, "rings": rings})
out = {"zmin": lo - 10, "interval": 10, "levels": levels}
p = ROOT / "assets/topo/hero-terraces.json"
p.write_text(json.dumps(out, separators=(",", ":")))
print(p, p.stat().st_size // 1024, "KB,", len(levels), "levels", lo, "...", hi)

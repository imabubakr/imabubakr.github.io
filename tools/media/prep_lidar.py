"""Cut the NRW point cloud around Freudenberg's old town, classify it and write
a compact binary for render_lidar.mjs.

NRW's 3D-Messdaten only separate ground (2, plus synthetic 26 / cellar 24) from
non-ground (1 unclassified, 20 last return not ground), so the classes are
derived here:
  height above ground (HAG) from a 1 m grid of the ground points, then
  building   = inside an official ALKIS footprint and HAG > 1.5 m
  vegetation = any other non-ground point with HAG > 0.5 m
  ground     = ground classes and the rest
Output: float32 x, y, z (metres, centred) + uint8 class (2 ground, 5 vegetation,
6 building, 9 water), randomly thinned to N_TARGET points.

    ~/miniforge3/envs/geoai/bin/python tools/media/prep_lidar.py
"""
import glob
import json
import zipfile
from pathlib import Path

import geopandas as gpd
import laspy
import numpy as np
from rasterio.features import rasterize
from rasterio.transform import from_origin
from scipy import ndimage

HERE = Path(__file__).resolve().parent
WORK = HERE / "work"
CENTER = (420820.0, 5639150.0)    # same as make_ortho.py
RADIUS = 330.0                    # circular cut (m): reads well while orbiting
N_TARGET = 2_400_000
GROUND = {2, 24, 26}
DROP = {18}                       # high noise


def footprints(bounds):
    gpkg = next(iter(glob.glob(str(WORK / "**/*.gpkg"), recursive=True)), None)
    if not gpkg:
        z = zipfile.ZipFile(next(iter(glob.glob(str(WORK / "gru_vereinf_*GeoPackage.zip")))))
        name = next(n for n in z.namelist() if n.endswith(".gpkg"))
        z.extract(name, WORK)
        gpkg = str(WORK / name)
    layers = list(gpd.list_layers(gpkg)["name"])
    layer = next((n for n in layers if "geb" in n.lower()), layers[0])
    gdf = gpd.read_file(gpkg, layer=layer, bbox=bounds)
    print("footprints:", len(gdf), "from layer", layer)
    return gdf


def main():
    xs, ys, zs, cs = [], [], [], []
    for f in sorted(glob.glob(str(WORK / "3dm_32_*.laz"))):
        las = laspy.read(f)
        x, y = np.asarray(las.x), np.asarray(las.y)
        m = (x - CENTER[0]) ** 2 + (y - CENTER[1]) ** 2 < RADIUS ** 2
        if not m.any():
            continue
        xs.append(x[m]); ys.append(y[m]); zs.append(np.asarray(las.z)[m])
        cs.append(np.asarray(las.classification)[m])
        print(f, m.sum(), "points in the cut")
    x, y, z, c = (np.concatenate(a) for a in (xs, ys, zs, cs))
    keep = ~np.isin(c, list(DROP))
    x, y, z, c = x[keep], y[keep], z[keep], c[keep]
    print("source classes:", dict(zip(*[a.tolist() for a in np.unique(c, return_counts=True)])))

    # 1 m ground grid -> height above ground
    x0, y1 = CENTER[0] - RADIUS - 5, CENTER[1] + RADIUS + 5
    n = int(2 * RADIUS + 10)
    g = np.isin(c, list(GROUND))
    col = ((x - x0)).astype(int).clip(0, n - 1)
    row = ((y1 - y)).astype(int).clip(0, n - 1)
    zsum = np.zeros((n, n)); zcnt = np.zeros((n, n))
    np.add.at(zsum, (row[g], col[g]), z[g]); np.add.at(zcnt, (row[g], col[g]), 1)
    dtm = np.where(zcnt > 0, zsum / np.maximum(zcnt, 1), np.nan)
    # fill gaps (under buildings) with the nearest ground value, then smooth lightly
    idx = ndimage.distance_transform_edt(np.isnan(dtm), return_distances=False, return_indices=True)
    dtm = ndimage.uniform_filter(dtm[tuple(idx)], 3)
    hag = z - dtm[row, col]

    # building footprints rasterised at 0.25 m
    fp = footprints((x0, y1 - n, x0 + n, y1))
    res = 0.25
    m = int(n / res)
    mask = rasterize(((geom, 1) for geom in fp.geometry), out_shape=(m, m),
                     transform=from_origin(x0, y1, res, res), fill=0, dtype="uint8")
    inside = mask[((y1 - y) / res).astype(int).clip(0, m - 1), ((x - x0) / res).astype(int).clip(0, m - 1)] == 1

    out = np.full(len(x), 2, np.uint8)
    nonground = ~g & (c != 9)
    out[nonground & inside & (hag > 1.5)] = 6
    out[nonground & ~(inside & (hag > 1.5)) & (hag > 0.5)] = 5
    out[c == 9] = 9
    print("derived classes:", dict(zip(*[a.tolist() for a in np.unique(out, return_counts=True)])))

    rng = np.random.default_rng(1)
    if len(x) > N_TARGET:
        sel = rng.choice(len(x), N_TARGET, replace=False)
        x, y, z, out = x[sel], y[sel], z[sel], out[sel]
    z0 = float(np.percentile(dtm, 1))
    pos = np.stack([x - CENTER[0], y - CENTER[1], z - z0], axis=1).astype(np.float32)
    (WORK / "lidar_pos.bin").write_bytes(pos.tobytes())
    (WORK / "lidar_cls.bin").write_bytes(out.tobytes())
    meta = {"n": int(len(x)), "zmax": float(np.percentile(pos[:, 2], 99.9))}
    (WORK / "lidar_meta.json").write_text(json.dumps(meta))
    print(meta)


if __name__ == "__main__":
    main()

"""Orthophoto + building outlines video: DOP10 of Freudenberg's old town, the
official ALKIS building footprints drawing in over it (nearest to the centre
first), while the view slowly zooms in. No text in the video (captions are on
the page, in both languages).

    ~/miniforge3/envs/geoai/bin/python tools/media/make_ortho.py

Writes assets/plates/ortho-buildings.{webm,mp4} and -720.webp (poster/thumbnail).
"""
import glob
import math
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.merge import merge
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
WORK = HERE / "work"
ROOT = HERE.parents[1]
OUT = ROOT / "assets/plates"

CENTER = (420820.0, 5639150.0)   # Alter Flecken, EPSG:25832 (set from the DOP overview)
HALF = (360.0, 230.0)            # half width/height of the area read (m)
W, H, FPS, SECONDS = 1600, 900, 30, 12
SS = 2                           # supersampling for smooth outlines
ZOOM = (0.34, 0.16)              # metres per output pixel at start and end
ACCENT = (210, 65, 15)           # --accent-mark (light theme), the site's survey orange


def ease(t):
    return t * t * (3 - 2 * t)


def load_ortho():
    files = sorted(glob.glob(str(WORK / "dop10rgbi_32_*.jp2")))
    srcs = [rasterio.open(f) for f in files]
    bounds = (CENTER[0] - HALF[0], CENTER[1] - HALF[1], CENTER[0] + HALF[0], CENTER[1] + HALF[1])
    arr, transform = merge(srcs, bounds=bounds, indexes=[1, 2, 3], res=0.1)
    img = Image.fromarray(np.moveaxis(arr, 0, -1))
    return img, bounds


def load_buildings(bounds):
    zips = glob.glob(str(WORK / "gru_vereinf_*GeoPackage.zip"))
    gpkg = next(iter(glob.glob(str(WORK / "gru_vereinf_*.gpkg"))), None)
    if not gpkg:
        with zipfile.ZipFile(zips[0]) as z:
            name = next(n for n in z.namelist() if n.endswith(".gpkg"))
            z.extract(name, WORK)
            gpkg = str(WORK / name)
    layers = gpd.list_layers(gpkg) if hasattr(gpd, "list_layers") else None
    layer = None
    if layers is not None:
        names = list(layers["name"])
        layer = next((n for n in names if "geb" in n.lower() or "building" in n.lower()), names[0])
        print("layer", layer, "of", names)
    gdf = gpd.read_file(gpkg, layer=layer, bbox=bounds)
    # buildings only (the layer also holds canopies, carports, arcades ...)
    if "gebnutzbez" in gdf.columns:
        gdf = gdf[gdf["gebnutzbez"] == "Gebäude"]
    gdf = gdf[gdf.geometry.notna()].explode(index_parts=False)
    gdf = gdf[gdf.geom_type == "Polygon"]
    print(len(gdf), "building polygons")
    return list(gdf.geometry)


def main():
    ortho, (x0, y0, x1, y1) = load_ortho()
    polys = load_buildings((x0, y0, x1, y1))
    # reveal order: by distance of the centroid from the centre
    cx, cy = CENTER
    order = sorted(polys, key=lambda p: math.hypot(p.centroid.x - cx, p.centroid.y - cy))
    rmax = math.hypot(*HALF)
    frames = WORK / "ortho_frames"
    shutil.rmtree(frames, ignore_errors=True)
    frames.mkdir(parents=True)
    n = FPS * SECONDS
    preview = "--preview" in sys.argv          # a few frames only, no encoding
    for i in range(n):
        if preview and i not in (0, 120, 200, n - 1):
            continue
        t = i / (n - 1)
        mpp = ZOOM[0] * (ZOOM[1] / ZOOM[0]) ** ease(t)      # geometric zoom
        vw, vh = W * mpp, H * mpp
        # crop box in ortho pixels (0.1 m), top-left origin
        left = (cx - vw / 2 - x0) / 0.1
        top = (y1 - (cy + vh / 2)) / 0.1
        box = (left, top, left + vw / 0.1, top + vh / 0.1)
        frame = ortho.transform((W * SS, H * SS), Image.EXTENT, box, Image.BICUBIC)
        # outlines: reveal radius grows from 2 s to 8 s
        rt = min(1, max(0, (t * SECONDS - 2) / 6))
        radius = ease(rt) * rmax
        over = Image.new("RGBA", frame.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(over)
        scale = SS / mpp
        for p in order:
            dist = math.hypot(p.centroid.x - cx, p.centroid.y - cy)
            if dist > radius:
                break
            k = min(1, (radius - dist) / 25)                  # each outline fades in over 25 m
            pts = [((x - (cx - vw / 2)) * scale, ((cy + vh / 2) - y) * scale) for x, y in p.exterior.coords]
            d.polygon(pts, fill=ACCENT + (int(46 * k),))
            d.line(pts + [pts[0]], fill=ACCENT + (int(235 * k),), width=max(3, round(1.8 * SS)), joint="curve")
        frame = Image.alpha_composite(frame.convert("RGBA"), over).convert("RGB")
        frame = frame.resize((W, H), Image.LANCZOS)
        frame.save(frames / f"{i:04d}.png")
        if i % 60 == 0:
            print(f"frame {i}/{n}")
    if preview:
        return
    OUT.mkdir(parents=True, exist_ok=True)
    pat = str(frames / "%04d.png")
    run = lambda *a: subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *a], check=True)
    run("-framerate", str(FPS), "-i", pat, "-pix_fmt", "yuv420p", "-c:v", "libvpx-vp9", "-crf", "34", "-b:v", "0",
        "-row-mt", "1", str(OUT / "ortho-buildings.webm"))
    run("-framerate", str(FPS), "-i", pat, "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:v", "libx264",
        "-preset", "slow", "-crf", "24", str(OUT / "ortho-buildings.mp4"))
    poster = Image.open(frames / f"{n - 1:04d}.png").convert("RGB")
    poster.resize((720, round(720 * H / W)), Image.LANCZOS).save(OUT / "ortho-buildings-720.webp", quality=80, method=6)
    print("done")


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Data for the page's finale: the Feldberg as a 3D digital twin (assets/topo/feldberg-*).

    python3 tools/finale/build_feldberg.py [workdir]      # needs GDAL >= 3.6 (CLI), numpy, Pillow

A 7 x 7 km tile around the Feldberg summit (UTM 32N / ETRS89, E 422080-429080, N 5299240-5306240):
  orthophoto  LGL Baden-Wuerttemberg DOP20 via WMS (fetched at 2 m), resized to TEX px, WebP
              licence: Datenlizenz Deutschland - Namensnennung - Version 2.0, credit "LGL-BW (year)"
  terrain     Copernicus DEM GLO-30 (AWS open data), warped to 25 m, Int16 metres, row 0 = north
Writes feldberg-dop.webp, feldberg-dem.bin and feldberg.json (tile in region scene coordinates: x east from
the region's west edge 391230, y south from its north edge 5334990, as region-contours.json).
"""
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

E0, N0, SIZE = 422080, 5299240, 7000          # tile south-west corner and side (m)
CELL, TEX = 25, 2048                           # DEM cell (m), texture size (px)
W, N = 391230, 5334990                         # region bbox west / north
OUT = Path(__file__).resolve().parents[2] / "assets" / "topo"
work = Path(sys.argv[1] if len(sys.argv) > 1 else "work-finale")
work.mkdir(parents=True, exist_ok=True)

dop = work / "dop.jpg"
if not dop.exists():
    url = ("https://owsproxy.lgl-bw.de/owsproxy/ows/WMS_LGL-BW_ATKIS_DOP_20_C?SERVICE=WMS&VERSION=1.3.0"
           "&REQUEST=GetMap&LAYERS=IMAGES_DOP_20_RGB&STYLES=&CRS=EPSG:25832"
           f"&BBOX={E0},{N0},{E0 + SIZE},{N0 + SIZE}&WIDTH=3500&HEIGHT=3500&FORMAT=image/jpeg")
    urllib.request.urlretrieve(url, dop)
Image.open(dop).convert("RGB").resize((TEX, TEX), Image.LANCZOS).save(OUT / "feldberg-dop.webp", quality=70, method=6)

dem = work / "dem.tif"
if not dem.exists():
    src = "/vsicurl/https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N47_00_{t}_00_DEM/" \
          "Copernicus_DSM_COG_10_N47_00_{t}_00_DEM.tif"
    (work / "list.txt").write_text("\n".join(src.format(t=t) for t in ("E007", "E008")))
    subprocess.run(["gdalbuildvrt", "-q", "-input_file_list", str(work / "list.txt"), str(work / "glo.vrt")], check=True)
    subprocess.run(["gdalwarp", "-q", "-overwrite", "-t_srs", "EPSG:25832", "-te", str(E0), str(N0), str(E0 + SIZE),
                    str(N0 + SIZE), "-tr", str(CELL), str(CELL), "-r", "cubic", str(work / "glo.vrt"), str(dem)], check=True)
raw = work / "dem.bin"
subprocess.run(["gdal_translate", "-q", "-of", "ENVI", "-ot", "Int16", str(dem), str(raw)], check=True)
z = np.fromfile(raw, dtype="<i2")
n = SIZE // CELL
assert z.size == n * n, z.size
z.astype("<i2").tofile(OUT / "feldberg-dem.bin")

meta = {"x0": E0 - W, "y0": N - (N0 + SIZE), "size": SIZE, "n": n, "cell": CELL, "zmax": int(z.max()),
        "dop": "LGL-BW, DOP20, dl-de/by-2-0", "dem": "Copernicus DEM GLO-30"}
(OUT / "feldberg.json").write_text(json.dumps(meta))
for f in ("feldberg-dop.webp", "feldberg-dem.bin", "feldberg.json"):
    print(f"assets/topo/{f}: {(OUT / f).stat().st_size / 1024:.0f} KB")
print(meta)

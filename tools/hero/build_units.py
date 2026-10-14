#!/usr/bin/env python3
"""Rock-unit outlines for the hero sheet (assets/topo/hero-units.json), pencilled on by pencil_labels.py.

    ~/miniforge3/envs/geoai/bin/python tools/hero/build_units.py units.gml     # needs geopandas

Input: the units of the LGRB geological overview map GÜK300 (layer ms:gu300af_m) around Freiburg, fetched
2026-10-14 from the LGRB WFS:
    https://services.lgrb-bw.de/index.phtml?SERVICE_NAME=lgrb_uek350_geologie&SERVICE=WFS&VERSION=1.1.0
        &REQUEST=GetFeature&TYPENAME=ms:gu300af_m&SRSNAME=EPSG:25832&BBOX=408000,5313500,419500,5320000,EPSG:25832
Keeps the small foothill blocks caught at the graben's edge that the sheet outlines in pencil (owner, 2026-10-14):
Middle Jurassic against the main fault north of Freiburg, and the Upper Bunter sandstone of the Lorettoberg.
Outlines in hero map metres (x east from the frame's west edge, y south from its north edge), clipped to the
frame, simplified to 20 m. Data: Regierungspräsidium Freiburg - LGRB (GÜK300), dl-de/by-2-0 (footer credit).
"""
import json
import sys
from pathlib import Path

import geopandas as gpd
from shapely.geometry import box

OUT = Path(__file__).resolve().parents[2] / "assets" / "topo" / "hero-units.json"
X0, Y0, X1, Y1 = 408660, 5314200, 418660, 5319200    # hero bbox (UTM 32N), hero-contours.json
KEEP = {"Mitteljura, ungegliedert": "jurassic", "Oberer Buntsandstein": "triassic"}
MIN_KM2 = 0.1                                          # drop slivers at the frame edge

g = gpd.read_file(sys.argv[1]).set_crs(25832, allow_override=True)
units = []
for name, key in KEEP.items():
    for geom in g[g.GLE == name].geometry:
        c = geom.intersection(box(X0, Y0, X1, Y1))
        for poly in getattr(c, "geoms", [c]):
            if poly.is_empty or poly.area / 1e6 < MIN_KM2:
                continue
            ring = poly.simplify(20).exterior.coords
            units.append({"unit": key, "pts": [[round(x - X0), round(Y1 - y)] for x, y in ring]})
OUT.write_text(json.dumps({"source": "LGRB-BW GÜK300, units", "units": units}, separators=(",", ":")))
print(f"{OUT.name}: {len(units)} outlines", [u["unit"] for u in units])

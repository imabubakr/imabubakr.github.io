#!/usr/bin/env python3
"""Fault lines for the hero sheet (assets/topo/hero-faults.json), pencilled on by pencil_labels.py.

    python3 tools/hero/build_faults.py tekt.gml                          # needs pyproj

Input: the tectonic lines of the LGRB geological overview map GÜK300 (layer ms:gu300tl_m) around Freiburg,
fetched 2026-10-14 from the LGRB WFS (UTM 32N; EPSG:4326 input from the 2026-10-13 fetch also works):
    https://services.lgrb-bw.de/index.phtml?SERVICE_NAME=lgrb_uek350_geologie&SERVICE=WFS&VERSION=1.1.0
        &REQUEST=GetFeature&TYPENAME=ms:gu300tl_m&SRSNAME=EPSG:25832&BBOX=407000,5312500,420500,5321000,EPSG:25832
Keeps the faults that cross the hero frame, proven ("Störung, nachgewiesen": along the foot of the Black Forest
that is the main border fault of the Upper Rhine Graben) and presumed ("Störung, vermutet", drawn dashed).
Writes them in hero map metres (x east from the frame's west edge, y south from its north edge, as the hero
SVG's viewBox), clipped to the frame, each with its type.
Data: Regierungspräsidium Freiburg - LGRB (GÜK300), dl-de/by-2-0, credited in the footer. Scale 1 : 300 000,
so the line is good to a few hundred metres.
"""
import json
import re
import sys
from pathlib import Path

from pyproj import Transformer

OUT = Path(__file__).resolve().parents[2] / "assets" / "topo" / "hero-faults.json"
X0, Y0, X1, Y1 = 408660, 5314200, 418660, 5319200    # hero bbox (UTM 32N), hero-contours.json
TYPES = {"nachgewiesen": "proven", "vermutet": "presumed"}
to_utm = Transformer.from_crs(4326, 32632, always_xy=True)

gml = Path(sys.argv[1]).read_text(encoding="utf-8")
lines = []
for f in re.findall(r"<ms:gu300tl_m>(.*?)</ms:gu300tl_m>", gml, re.S):
    kind = re.search(r"<ms:Stoerungstyp>([^<]*)", f).group(1)
    typ = next((t for k, t in TYPES.items() if k in kind), None)
    if not typ:
        continue
    for m in re.finditer(r"<gml:posList([^>]*)>([^<]*)", f):
        v = [float(t) for t in m.group(2).split()]
        if v[0] < 1000:                                    # lat lon (EPSG:4326)
            pts = [to_utm.transform(v[i + 1], v[i]) for i in range(0, len(v), 2)]
        else:                                              # easting northing (EPSG:25832)
            pts = [(v[i], v[i + 1]) for i in range(0, len(v), 2)]
        pts = [(e - X0, Y1 - n) for e, n in pts]
        run, runs = [], []
        for x, y in pts:                                   # the parts inside the frame (a little beyond, so
            if -200 <= x <= 10200 and -200 <= y <= 5200:   # the line reaches the edges)
                run.append([round(x), round(y)])
            elif run:
                runs.append(run); run = []
        if run:
            runs.append(run)
        lines += [{"type": typ, "pts": r} for r in runs if len(r) > 1]
OUT.write_text(json.dumps({"source": "LGRB-BW GÜK300, faults (proven and presumed)", "lines": lines},
                          separators=(",", ":")))
print(f"{OUT.name}: {len(lines)} lines ({sum(l['type'] == 'proven' for l in lines)} proven)")

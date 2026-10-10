#!/usr/bin/env python3
"""Map features for the aerial survey in section [02] (assets/topo/aerial-features.json).

    python3 tools/orbit/build_aerial.py buildings.json features.json      # needs pyproj

Inputs: Overpass API JSON exports of OpenStreetMap around the survey (fetched 2026-10-10), bbox
47.96454,7.84129,48.00241,7.89356:
    buildings.json  [out:json];way["building"](bbox);out geom;
    features.json   [out:json];(way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|
                    residential|living_street|pedestrian|..._link|service|footway|path|cycleway|track)$"](bbox);
                    way["railway"~"^(rail|tram|light_rail)$"](bbox);way["waterway"~"^(river|stream|canal)$"](bbox);
                    way["natural"="water"](bbox);way["landuse"="forest"](bbox);way["natural"="wood"](bbox););out geom;
Keeps what lies in the area the survey block covers (route positions SURVEY_A, lateral +-SURVEY_L, see SV /
SURVEY_AT in assets/js/backdrop.js), simplifies (Douglas-Peucker, TOL m) and writes region scene coordinates
(m, x east from the region's west edge, y south from its north edge, as the DEM), each line or outline as
[x0, y0, dx1, dy1, ...], grouped by layer (LAYERS). Data (c) OpenStreetMap contributors, ODbL.
"""
import json
import math
import sys
from pathlib import Path

from pyproj import Transformer

OUT = Path(__file__).resolve().parents[2] / "assets" / "topo" / "aerial-features.json"
W, N = 391230, 5334990                       # region bbox west / north (UTM 32N), region-contours.json
FREIBURG, FELDBERG = (23143, 18541), (34350, 32250)
SURVEY_A, SURVEY_L = (6000, 7800), 760       # route positions (SURVEY_AT 6900 +- block) and lateral half-width
TOL, MIN_AREA = 1.0, 25.0
MAJOR = {"motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link", "primary_link",
         "secondary_link", "tertiary_link"}
MINOR = {"unclassified", "residential", "living_street", "pedestrian", "service"}
PATHS = {"footway", "path", "cycleway", "track"}


def layer(t):
    """The drawing layer of an OSM way (tags t), or None."""
    if "building" in t:
        return "building"
    hw = t.get("highway")
    if hw in MAJOR:
        return "major"
    if hw in MINOR:
        return "minor"
    if hw in PATHS:
        return "path"
    if t.get("railway") == "rail":
        return "rail"
    if t.get("railway") in ("tram", "light_rail"):
        return "tram"
    if t.get("waterway") == "river" or t.get("waterway") == "canal":
        return "river"
    if t.get("waterway") == "stream":
        return "stream"
    if t.get("natural") == "water":
        return "water"
    if t.get("landuse") == "forest" or t.get("natural") == "wood":
        return "wood"
    return None


AREAS = {"building", "water", "wood"}
LAYERS = ["wood", "water", "stream", "river", "path", "minor", "major", "tram", "rail", "building"]

vx, vy = FELDBERG[0] - FREIBURG[0], FELDBERG[1] - FREIBURG[1]
n = math.hypot(vx, vy)
UX, UY = vx / n, vy / n
OX, OY = FREIBURG[0] - UX * 6000, FREIBURG[1] - UY * 6000
to_utm = Transformer.from_crs(4326, 32632, always_xy=True)


def inside(x, y, margin=0):
    a = (x - OX) * UX + (y - OY) * UY
    l = (x - OX) * -UY + (y - OY) * UX
    return SURVEY_A[0] - margin <= a <= SURVEY_A[1] + margin and abs(l) <= SURVEY_L + margin


def dp(pts, tol):
    """Douglas-Peucker simplification of an open polyline."""
    if len(pts) < 3:
        return pts
    (x0, y0), (x1, y1) = pts[0], pts[-1]
    dx, dy = x1 - x0, y1 - y0
    L = math.hypot(dx, dy) or 1e-9
    i, dmax = 0, -1
    for k in range(1, len(pts) - 1):
        d = abs(dy * (pts[k][0] - x0) - dx * (pts[k][1] - y0)) / L
        if d > dmax:
            i, dmax = k, d
    if dmax <= tol:
        return [pts[0], pts[-1]]
    return dp(pts[: i + 1], tol)[:-1] + dp(pts[i:], tol)


def area(pts):
    return abs(sum(pts[k][0] * pts[k - 1][1] - pts[k - 1][0] * pts[k][1] for k in range(len(pts)))) / 2


def encode(pts):
    q = [(round(x), round(y)) for x, y in pts]
    flat = [q[0][0], q[0][1]]
    for k in range(1, len(q)):
        flat += [q[k][0] - q[k - 1][0], q[k][1] - q[k - 1][1]]
    return flat


out = {k: [] for k in LAYERS}
seen = set()
for src in sys.argv[1:]:
    for el in json.load(open(src))["elements"]:
        g, kind = el.get("geometry"), layer(el.get("tags", {}))
        if not g or len(g) < 2 or not kind or el["id"] in seen:
            continue
        seen.add(el["id"])
        pts = []
        for p in g:
            e, nn = to_utm.transform(p["lon"], p["lat"])
            pts.append((e - W, N - nn))
        if kind == "building":
            cx, cy = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
            if not inside(cx, cy):
                continue
        elif not any(inside(x, y, 150) for x, y in pts):
            continue
        if kind in AREAS:
            if len(pts) < 4:
                continue
            if pts[0] == pts[-1]:
                pts = pts[:-1]
            if area(pts) < MIN_AREA:
                continue
            # split the closed ring at its first vertex and the farthest one, simplify both halves
            far = max(range(len(pts)), key=lambda k: math.dist(pts[0], pts[k]))
            pts = dp(pts[: far + 1], TOL)[:-1] + dp(pts[far:] + [pts[0]], TOL)[:-1]
            if len(pts) < 3:
                continue
        else:
            pts = dp(pts, TOL)
        out[kind].append(encode(pts))

out = {k: v for k, v in out.items() if v}
OUT.write_text(json.dumps({"src": "(c) OpenStreetMap contributors, ODbL", "layers": out}, separators=(",", ":")))
print(f"{OUT.relative_to(OUT.parents[2])}: {OUT.stat().st_size / 1024:.0f} KB")
for k, v in out.items():
    print(f"  {k:9s} {len(v)}")

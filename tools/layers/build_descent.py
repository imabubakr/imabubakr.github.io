"""Build the data for the "From orbit to drone" career story (assets/layers/descent.json).

Ebringen near Freiburg, 1600 x 1000 m: OSM land cover (classes below), roads, streams
and building footprints, in metres from the top-left (y down), delta-encoded integers.
assets/js/descent.js draws them at each platform's ground resolution while visitors
scroll through the three career chapters.

Inputs (tools/layers/work/, Overpass JSON):
  village.json    buildings (fetched by build_layers.py)
  landcover.json  landuse/natural/leisure areas, highways, waterways:
    [out:json];(way["landuse"](S,W,N,E);relation["landuse"](S,W,N,E);
     way["natural"~"wood|scrub|grassland|water"](S,W,N,E);relation["natural"~"wood|water"](S,W,N,E);
     way["leisure"~"park|pitch|garden"](S,W,N,E);way["highway"](S,W,N,E);way["waterway"](S,W,N,E););out geom;
    with S,W,N,E = 47.9495,7.7615,47.9655,7.7905

Run from the repo root: python3 tools/layers/build_descent.py
"""

import json
from pathlib import Path

import numpy as np
from osgeo import osr

osr.UseExceptions()

ROOT = Path(__file__).resolve().parents[2]
WORK = Path(__file__).resolve().parent / "work"
OUT = ROOT / "assets/layers/descent.json"
CENTER = (7.7760, 47.9575)  # Ebringen
W, H = 1600, 1000
MARGIN = 150

# land-cover classes (index = class id, drawn in this order)
CLASSES = ["urban", "field", "meadow", "orchard", "vineyard", "garden", "scrub", "forest", "water"]
TAGS = {
    ("landuse", "residential"): "urban", ("landuse", "commercial"): "urban", ("landuse", "industrial"): "urban",
    ("landuse", "retail"): "urban", ("landuse", "farmyard"): "urban", ("landuse", "cemetery"): "garden",
    ("landuse", "farmland"): "field", ("landuse", "meadow"): "meadow", ("landuse", "grass"): "meadow",
    ("natural", "grassland"): "meadow", ("landuse", "village_green"): "meadow", ("landuse", "orchard"): "orchard",
    ("landuse", "vineyard"): "vineyard", ("landuse", "allotments"): "garden", ("leisure", "garden"): "garden",
    ("leisure", "park"): "garden", ("leisure", "pitch"): "meadow", ("natural", "scrub"): "scrub",
    ("landuse", "forest"): "forest", ("natural", "wood"): "forest", ("natural", "water"): "water",
    ("landuse", "basin"): "water", ("landuse", "reservoir"): "water",
}
ROADS = {  # highway -> width class 0 (path) .. 3 (main road)
    "trunk": 3, "primary": 3, "primary_link": 3, "secondary": 3, "tertiary": 2, "unclassified": 2,
    "residential": 2, "living_street": 2, "pedestrian": 1, "service": 1, "track": 1,
    "footway": 0, "path": 0, "steps": 0, "cycleway": 0,
}


def transformer():
    wgs = osr.SpatialReference()
    wgs.ImportFromEPSG(4326)
    wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    utm = osr.SpatialReference()
    utm.ImportFromEPSG(32632)
    ct = osr.CoordinateTransformation(wgs, utm)
    cx, cy = ct.TransformPoint(*CENTER)[:2]
    x0, y1 = cx - W / 2, cy + H / 2
    return lambda geom: np.array([[ct.TransformPoint(g["lon"], g["lat"])[0] - x0,
                                   y1 - ct.TransformPoint(g["lon"], g["lat"])[1]] for g in geom])


def near(p):
    return not (p[:, 0].max() < -MARGIN or p[:, 0].min() > W + MARGIN or p[:, 1].max() < -MARGIN or p[:, 1].min() > H + MARGIN)


def encode(p, closed):
    q = np.round(p).astype(int)
    if closed and len(q) > 1 and (q[0] == q[-1]).all():
        q = q[:-1]
    q = q[np.r_[True, (np.diff(q, axis=0) != 0).any(axis=1)]]
    if len(q) < (3 if closed else 2):
        return None
    return np.vstack([q[:1], np.diff(q, axis=0)]).ravel().tolist()


def join_rings(ways):
    """Assemble multipolygon outer members (lists of points) into closed rings."""
    ways = [list(map(tuple, w)) for w in ways]
    rings = []
    while ways:
        ring = ways.pop(0)
        changed = True
        while ring[0] != ring[-1] and changed:
            changed = False
            for i, w in enumerate(ways):
                if w[0] == ring[-1]:
                    ring += w[1:]
                elif w[-1] == ring[-1]:
                    ring += w[::-1][1:]
                elif w[-1] == ring[0]:
                    ring = w + ring[1:]
                elif w[0] == ring[0]:
                    ring = w[::-1] + ring[1:]
                else:
                    continue
                ways.pop(i)
                changed = True
                break
        rings.append(np.array(ring))
    return rings


def area(p):
    x, y = p[:, 0], p[:, 1]
    return 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))


def main():
    to_map = transformer()
    lc, roads, streams, buildings = [], [], [], []

    for el in json.loads((WORK / "landcover.json").read_text())["elements"]:
        tags = el.get("tags", {})
        cls = next((TAGS[(k, tags[k])] for k in ("landuse", "natural", "leisure") if (k, tags.get(k)) in TAGS), None)
        if el["type"] == "way" and "geometry" in el:
            p = to_map(el["geometry"])
            if not near(p):
                continue
            if cls:
                enc = encode(p, True)
                if enc:
                    lc.append((CLASSES.index(cls), area(p), enc))
            elif tags.get("highway") in ROADS:
                enc = encode(p, False)
                if enc:
                    roads.append([ROADS[tags["highway"]], enc])
            elif "waterway" in tags:
                enc = encode(p, False)
                if enc:
                    streams.append(enc)
        elif el["type"] == "relation" and cls:
            outers = [to_map(m["geometry"]) for m in el.get("members", [])
                      if m.get("role") == "outer" and "geometry" in m]
            for ring in join_rings(outers):
                if near(ring):
                    enc = encode(ring, True)
                    if enc:
                        lc.append((CLASSES.index(cls), area(ring), enc))

    for el in json.loads((WORK / "village.json").read_text())["elements"]:
        if el.get("type") == "way" and "geometry" in el:
            p = to_map(el["geometry"])
            if near(p):
                enc = encode(p, True)
                if enc:
                    buildings.append(enc)

    # big areas first so small ones (gardens inside farmland, ponds) stay on top
    lc.sort(key=lambda t: -t[1])
    cents = np.array([[np.cumsum(b[0::2])[:].mean(), np.cumsum(b[1::2]).mean()] for b in buildings])
    best, score = (W / 2, H / 2), -1
    for x in range(400, 1201, 10):
        for y in range(300, 701, 10):
            n = int(((abs(cents[:, 0] - x) < 34) & (abs(cents[:, 1] - y) < 19)).sum())
            if n > score:
                best, score = (x, y), n

    data = {"w": W, "h": H, "classes": CLASSES, "focus": best,
            "lc": [[c, enc] for c, _, enc in lc], "roads": roads, "streams": streams, "b": buildings,
            "credit": "© OpenStreetMap contributors (ODbL)"}
    OUT.write_text(json.dumps(data, separators=(",", ":")))
    print(f"{len(lc)} land-cover areas, {len(roads)} roads, {len(streams)} streams, {len(buildings)} buildings; "
          f"focus {best}; {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()

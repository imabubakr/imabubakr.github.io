"""Add place labels and the hero's frame to the region map metadata.

Summits are found, not typed in: the highest cell of the region's elevation grid
inside a search window, so label positions and heights come from the same DEM.
Writes "places" and "hero_frame" (map coordinates, metres from the top-left) into
assets/topo/region-contours.json. Run after make_contours.sh built both maps:

    python3 tools/contours/region_extras.py
"""

import json
from pathlib import Path

import numpy as np
from osgeo import osr

osr.UseExceptions()

ROOT = Path(__file__).resolve().parents[2]
REGION = ROOT / "assets/topo/region-contours.json"
HERO = ROOT / "assets/topo/hero-contours.json"

# name (EN, DE), kind, search window (lon0, lat0, lon1, lat1) or a fixed point
PLACES = [
    ("Kaiserstuhl", "Kaiserstuhl", "summit", (7.60, 48.05, 7.75, 48.15)),
    ("Schauinsland", "Schauinsland", "summit", (7.86, 47.89, 7.93, 47.93)),
    ("Feldberg", "Feldberg", "summit", (7.97, 47.85, 8.04, 47.89)),
    ("Freiburg", "Freiburg", "town", (7.8522, 47.9956)),  # Münster
]


def main():
    meta = json.loads(REGION.read_text())
    hero = json.loads(HERO.read_text())
    utm = osr.SpatialReference()
    utm.ImportFromEPSG(meta["epsg"])
    wgs = osr.SpatialReference()
    wgs.ImportFromEPSG(4326)
    wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    fwd = osr.CoordinateTransformation(wgs, utm)
    xmin, ymin, xmax, ymax = meta["bbox"]
    g = meta["grid"]
    grid = np.frombuffer((REGION.parent / g["file"]).read_bytes(), dtype="<i2").reshape(g["rows"], g["cols"])

    def to_map(lon, lat):
        x, y = fwd.TransformPoint(lon, lat)[:2]
        return x - xmin, ymax - y

    places = []
    for en, de, kind, where in PLACES:
        if kind == "summit":
            (x0, y0), (x1, y1) = to_map(where[0], where[3]), to_map(where[2], where[1])
            c0, c1 = int(x0 // g["cell_m"][0]), int(x1 // g["cell_m"][0]) + 1
            r0, r1 = int(y0 // g["cell_m"][1]), int(y1 // g["cell_m"][1]) + 1
            win = grid[r0:r1, c0:c1]
            r, c = np.unravel_index(np.argmax(win), win.shape)
            x, y = (c0 + c + 0.5) * g["cell_m"][0], (r0 + r + 0.5) * g["cell_m"][1]
            elev = int(win[r, c])
        else:
            x, y = to_map(*where)
            elev = None
        places.append({"en": en, "de": de, "kind": kind, "x": round(x), "y": round(y), "elev": elev})
        print(f"{en:13} {kind:6} x={x:7.0f} y={y:7.0f} {elev or ''}")

    hx0, hy0, hx1, hy1 = hero["bbox"]
    meta["places"] = places
    meta["hero_frame"] = [hx0 - xmin, ymax - hy1, hx1 - xmin, ymax - hy0]
    meta["hero_marker"] = list(map(round, to_map(hero["lon"], hero["lat"])))
    REGION.write_text(json.dumps(meta, indent=2))
    print("hero frame", meta["hero_frame"])


if __name__ == "__main__":
    main()

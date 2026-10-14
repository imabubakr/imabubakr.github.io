"""Build assets/topo/earth.json: coastlines and land borders around Europe for
the orbit view of section [02] (assets/js/backdrop.js). Country outlines only:
islands smaller than MIN_SIZE are left out; every land border is kept (each
border between two countries is its own line, many of them short).

Source: Natural Earth 1:50m (public domain), https://www.naturalearthdata.com/
  ne_50m_coastline, ne_50m_admin_0_boundary_lines_land

    python3 tools/orbit/build_earth.py <folder with the unzipped shapefiles>

Needs GDAL (ogr2ogr). Lines are clipped to the area visible from orbit above
Freiburg, simplified and stored as flat [lon, lat, lon, lat, ...] arrays.
"""
import json, subprocess, sys, tempfile
from pathlib import Path

BBOX = (-32, 28, 50, 72)        # lon/lat window seen from ~705 km above Freiburg
TOL = 0.04                      # simplification tolerance (degrees)
MIN_SIZE = 1.2                  # drop coastline pieces whose bounding box is smaller than this (degrees)
LAYERS = {
    "coast": ("ne_50m_coastline", None, MIN_SIZE),
    "borders": ("ne_50m_admin_0_boundary_lines_land", None, 0),
}

def lines(src, where, min_size):
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.geojson"
        cmd = ["ogr2ogr", "-f", "GeoJSON", str(out), str(src), "-clipsrc", *map(str, BBOX),
               "-simplify", str(TOL), "-explodecollections"]
        if where:
            cmd += ["-where", where]
        subprocess.run(cmd, check=True, capture_output=True)
        feats = json.loads(out.read_text())["features"]
    # clipping can still leave MultiLineStrings (the long mainland coasts): split them here
    parts = []
    for f in feats:
        g = f["geometry"]
        if not g:
            continue
        if g["type"] == "LineString":
            parts.append(g["coordinates"])
        elif g["type"] == "MultiLineString":
            parts.extend(g["coordinates"])
    res = []
    for c in parts:
        if len(c) < 2:
            continue
        xs = [p[0] for p in c]
        ys = [p[1] for p in c]
        if max(max(xs) - min(xs), max(ys) - min(ys)) < min_size:
            continue
        res.append([round(v, 2) for pt in c for v in pt[:2]])
    return res

def main():
    src = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    data = {k: lines(src / f"{name}.shp", where, size) for k, (name, where, size) in LAYERS.items()}
    data["source"] = "Natural Earth 1:50m (public domain)"
    out = Path(__file__).resolve().parents[2] / "assets/topo/earth.json"
    out.write_text(json.dumps(data, separators=(",", ":")))
    print(out, out.stat().st_size // 1024, "KB", {k: len(v) for k, v in data.items() if k != "source"})

if __name__ == "__main__":
    main()

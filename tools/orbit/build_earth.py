"""Build assets/topo/earth.json: coastlines and land borders around Europe for
the orbit view of section [02] (assets/js/backdrop.js). Country outlines only:
islands and coastline pieces smaller than MIN_SIZE are left out.

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
MIN_SIZE = 1.2                  # drop lines whose bounding box is smaller than this (degrees)
LAYERS = {
    "coast": ("ne_50m_coastline", None),
    "borders": ("ne_50m_admin_0_boundary_lines_land", None),
}

def lines(src, where):
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.geojson"
        cmd = ["ogr2ogr", "-f", "GeoJSON", str(out), str(src), "-clipsrc", *map(str, BBOX),
               "-simplify", str(TOL), "-explodecollections"]
        if where:
            cmd += ["-where", where]
        subprocess.run(cmd, check=True, capture_output=True)
        feats = json.loads(out.read_text())["features"]
    res = []
    for f in feats:
        g = f["geometry"]
        if not g or g["type"] != "LineString" or len(g["coordinates"]) < 2:
            continue
        xs = [p[0] for p in g["coordinates"]]
        ys = [p[1] for p in g["coordinates"]]
        if max(max(xs) - min(xs), max(ys) - min(ys)) < MIN_SIZE:
            continue
        res.append([round(v, 2) for pt in g["coordinates"] for v in pt])
    return res

def main():
    src = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    data = {k: lines(src / f"{name}.shp", where) for k, (name, where) in LAYERS.items()}
    data["source"] = "Natural Earth 1:50m (public domain)"
    out = Path(__file__).resolve().parents[2] / "assets/topo/earth.json"
    out.write_text(json.dumps(data, separators=(",", ":")))
    print(out, out.stat().st_size // 1024, "KB", {k: len(v) for k, v in data.items() if k != "source"})

if __name__ == "__main__":
    main()

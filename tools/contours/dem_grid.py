"""Export a coarse elevation grid and a map→lat/lon formula for the hero's map tools.

Writes `<out>.bin` (int16 little-endian, row-major, north row first, metres) and adds
to `<out>.json`:
  "grid":   cols, rows, cell size and file name of the binary grid
  "lonlat": quadratic polynomials mapping SVG map coordinates (x east, y south, metres
            from the top-left of the map) to longitude/latitude, so the page needs no
            projection library. The max fit error is printed and stored.
"""

import argparse
import json
from pathlib import Path

import numpy as np
from osgeo import gdal, osr

gdal.UseExceptions()
osr.UseExceptions()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dem", required=True, help="unsmoothed DEM in the map's UTM CRS")
    p.add_argument("--out", required=True, help="output prefix, e.g. assets/topo/hero-contours")
    p.add_argument("--cols", type=int, default=200)
    p.add_argument("--rows", type=int, default=100)
    args = p.parse_args()

    meta_path = Path(args.out + ".json")
    meta = json.loads(meta_path.read_text())
    xmin, ymin, xmax, ymax = meta["bbox"]
    width, height = xmax - xmin, ymax - ymin

    grid = gdal.Warp("", args.dem, format="MEM", outputBounds=(xmin, ymin, xmax, ymax),
                     width=args.cols, height=args.rows, resampleAlg="average")
    elev = np.rint(grid.GetRasterBand(1).ReadAsArray()).astype("<i2")
    bin_path = Path(args.out + "-dem.bin")
    bin_path.write_bytes(elev.tobytes())

    utm = osr.SpatialReference()
    utm.ImportFromEPSG(meta["epsg"])
    wgs = osr.SpatialReference()
    wgs.ImportFromEPSG(4326)
    wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    to_geo = osr.CoordinateTransformation(utm, wgs)

    xs, ys = np.meshgrid(np.linspace(0, width, 21), np.linspace(0, height, 11))
    xs, ys = xs.ravel(), ys.ravel()
    geo = np.array([to_geo.TransformPoint(xmin + x, ymax - y)[:2] for x, y in zip(xs, ys)])
    terms = np.column_stack([np.ones_like(xs), xs, ys, xs * xs, xs * ys, ys * ys])
    lon_c, *_ = np.linalg.lstsq(terms, geo[:, 0], rcond=None)
    lat_c, *_ = np.linalg.lstsq(terms, geo[:, 1], rcond=None)
    err_lon = np.abs(terms @ lon_c - geo[:, 0]).max() * 111320 * np.cos(np.radians(meta["lat"]))
    err_lat = np.abs(terms @ lat_c - geo[:, 1]).max() * 110574
    max_err = float(max(err_lon, err_lat))

    meta["grid"] = {"file": bin_path.name, "cols": args.cols, "rows": args.rows,
                    "cell_m": [width / args.cols, height / args.rows]}
    meta["lonlat"] = {"terms": "1 x y x² xy y²", "lon": lon_c.tolist(), "lat": lat_c.tolist(),
                      "max_error_m": round(max_err, 3)}
    meta_path.write_text(json.dumps(meta, indent=2))
    print(f"grid {args.cols}x{args.rows} ({bin_path.stat().st_size} bytes), "
          f"elevation {elev.min()}–{elev.max()} m, lat/lon fit max error {max_err:.3f} m")


if __name__ == "__main__":
    main()

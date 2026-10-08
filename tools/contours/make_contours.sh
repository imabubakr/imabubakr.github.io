#!/usr/bin/env bash
# Generate the hero contour SVG from a real DEM.
#
#   DEM (Copernicus GLO-30, fetched over HTTP, or --dem <file>)
#     -> reproject to UTM, crop, smooth            (gdalwarp)
#     -> 10 m contours with elevation attribute    (gdal_contour)
#     -> clip, simplify, tag every 5th as index    (mapshaper)
#     -> SVG paths + uphill-facing index labels    (contours_to_svg.py)
#     -> optimise                                  (svgo)
#     -> coarse elevation grid + lat/lon formula   (dem_grid.py, for the map tools)
#
# Requires: GDAL >= 3.6 with Python bindings + numpy, Node (run `npm ci` here once).
#
# Usage:
#   tools/contours/make_contours.sh [--lat 47.997791] [--lon 7.842609]
#       [--width 10000] [--height 5000]    extent in metres, centred on lat/lon
#       [--interval 10] [--index-every 5]   contour interval (m), index contour step
#       [--smooth 60]                       smoothing cell size (m), 0 = off
#       [--simplify 12]                     mapshaper Visvalingam interval (m)
#       [--dem path/to/dem.tif]             use a local DEM instead of downloading
#       [--out assets/topo/hero-contours]   output prefix (.svg + .json)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

LAT=47.997791
LON=7.842609
WIDTH=10000
HEIGHT=5000
INTERVAL=10
INDEX_EVERY=5
SMOOTH=60
SIMPLIFY=12
DEM=""
OUT="$ROOT/assets/topo/hero-contours"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --lat) LAT="$2"; shift 2 ;;
    --lon) LON="$2"; shift 2 ;;
    --width) WIDTH="$2"; shift 2 ;;
    --height) HEIGHT="$2"; shift 2 ;;
    --interval) INTERVAL="$2"; shift 2 ;;
    --index-every) INDEX_EVERY="$2"; shift 2 ;;
    --smooth) SMOOTH="$2"; shift 2 ;;
    --simplify) SIMPLIFY="$2"; shift 2 ;;
    --dem) DEM="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

for tool in gdalwarp gdal_contour gdaltransform gdallocationinfo gdalbuildvrt python3; do
  command -v "$tool" >/dev/null || { echo "missing: $tool" >&2; exit 1; }
done
MAPSHAPER="$HERE/node_modules/.bin/mapshaper"
SVGO="$HERE/node_modules/.bin/svgo"
[[ -x "$MAPSHAPER" && -x "$SVGO" ]] || { echo "run 'npm ci' in $HERE first" >&2; exit 1; }

WORK="$HERE/work"
mkdir -p "$WORK" "$(dirname "$OUT")"

# --- 1. Target CRS: WGS 84 / UTM zone of the centre point -------------------
ZONE=$(python3 -c "import math; print(int(math.floor(($LON + 180) / 6)) + 1)")
if python3 -c "import sys; sys.exit(0 if $LAT >= 0 else 1)"; then
  EPSG=$((32600 + ZONE)); HEMI=N
else
  EPSG=$((32700 + ZONE)); HEMI=S
fi
read -r CX CY <<<"$(echo "$LON $LAT" | gdaltransform -s_srs EPSG:4326 -t_srs EPSG:$EPSG -output_xy)"

# Extent snapped to the 10 m grid, plus a buffer so contours run off the edges cleanly.
read -r XMIN YMIN XMAX YMAX <<<"$(python3 -c "
r = lambda v: round(v / 10) * 10
print(r($CX - $WIDTH / 2), r($CY - $HEIGHT / 2), r($CX + $WIDTH / 2), r($CY + $HEIGHT / 2))")"
BUF=500
echo "centre $LAT,$LON -> EPSG:$EPSG ($CX, $CY); extent $XMIN $YMIN $XMAX $YMAX"

# --- 2. DEM source ------------------------------------------------------------
if [[ -z "$DEM" ]]; then
  # Copernicus GLO-30 1x1 degree COG tiles covering the buffered extent.
  TILES=$(python3 - "$EPSG" "$XMIN" "$YMIN" "$XMAX" "$YMAX" "$BUF" <<'EOF'
import math, sys
from osgeo import osr
osr.UseExceptions()
epsg, xmin, ymin, xmax, ymax, buf = int(sys.argv[1]), *map(float, sys.argv[2:])
src = osr.SpatialReference(); src.ImportFromEPSG(epsg)
dst = osr.SpatialReference(); dst.ImportFromEPSG(4326)
dst.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
ct = osr.CoordinateTransformation(src, dst)
pts = [ct.TransformPoint(x, y)[:2] for x in (xmin - buf, xmax + buf) for y in (ymin - buf, ymax + buf)]
lons, lats = [p[0] for p in pts], [p[1] for p in pts]
for lat in range(math.floor(min(lats)), math.floor(max(lats)) + 1):
    for lon in range(math.floor(min(lons)), math.floor(max(lons)) + 1):
        ns, ew = ("N" if lat >= 0 else "S"), ("E" if lon >= 0 else "W")
        name = f"Copernicus_DSM_COG_10_{ns}{abs(lat):02d}_00_{ew}{abs(lon):03d}_00_DEM"
        print(f"/vsicurl/https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif")
EOF
)
  # shellcheck disable=SC2086
  gdalbuildvrt -q -overwrite "$WORK/src.vrt" $TILES
  SRC="$WORK/src.vrt"
  DEM_SOURCE="Copernicus DEM GLO-30"
else
  SRC="$DEM"
  DEM_SOURCE="$(basename "$DEM")"
fi

# --- 3. Reproject + crop, then smooth (block-average down, B-spline back up) -----
gdalwarp -q -overwrite -t_srs "EPSG:$EPSG" -te $((XMIN - BUF)) $((YMIN - BUF)) $((XMAX + BUF)) $((YMAX + BUF)) \
  -tr 10 10 -r cubic -co COMPRESS=DEFLATE "$SRC" "$WORK/dem.tif"
if [[ "$SMOOTH" -gt 10 ]]; then
  gdalwarp -q -overwrite -tr "$SMOOTH" "$SMOOTH" -r average "$WORK/dem.tif" "$WORK/dem_coarse.tif"
  gdalwarp -q -overwrite -tr 10 10 -r cubicspline -te $((XMIN - BUF)) $((YMIN - BUF)) $((XMAX + BUF)) $((YMAX + BUF)) \
    "$WORK/dem_coarse.tif" "$WORK/dem_smooth.tif"
else
  cp "$WORK/dem.tif" "$WORK/dem_smooth.tif"
fi

# --- 4. Contours ---------------------------------------------------------------
rm -f "$WORK/contours.geojson"
gdal_contour -q -i "$INTERVAL" -a elev -f GeoJSON "$WORK/dem_smooth.tif" "$WORK/contours.geojson"

# --- 5. Clip, simplify, tag index contours ------------------------------------
INDEX_STEP=$((INTERVAL * INDEX_EVERY))
"$MAPSHAPER" -i "$WORK/contours.geojson" -quiet \
  -clip bbox="$XMIN,$YMIN,$XMAX,$YMAX" \
  -simplify visvalingam weighted interval="$SIMPLIFY" \
  -each "elev = Math.round(elev); index = elev % $INDEX_STEP === 0" \
  -o "$WORK/contours_simplified.geojson" force

# --- 6. SVG with labels, then SVGO ------------------------------------------------
python3 "$HERE/contours_to_svg.py" \
  --contours "$WORK/contours_simplified.geojson" \
  --dem "$WORK/dem_smooth.tif" \
  --bbox "$XMIN" "$YMIN" "$XMAX" "$YMAX" \
  --out "$WORK/raw.svg"
"$SVGO" -q --config "$HERE/svgo.config.mjs" -i "$WORK/raw.svg" -o "$OUT.svg"

# --- 7. Metadata for the hero label and the map collar -------------------------
ELEV=$(gdallocationinfo -valonly -wgs84 "$SRC" "$LON" "$LAT")
python3 - "$OUT.json" <<EOF
import json, sys
json.dump({
  "lat": $LAT, "lon": $LON,
  "elevation_m": round($ELEV),
  "crs": "WGS 84 / UTM zone $ZONE$HEMI", "epsg": $EPSG,
  "bbox": [$XMIN, $YMIN, $XMAX, $YMAX],
  "width_m": $XMAX - $XMIN, "height_m": $YMAX - $YMIN,
  "contour_interval_m": $INTERVAL, "index_every": $INDEX_EVERY,
  "dem": "$DEM_SOURCE",
}, open(sys.argv[1], "w"), indent=2)
EOF

# --- 8. Elevation grid + lat/lon formula for the hero's coordinate/profile tools --
python3 "$HERE/dem_grid.py" --dem "$WORK/dem.tif" --out "$OUT"

printf 'wrote %s.svg (%s bytes, %s gzipped) and %s.json; elevation at centre %s m\n' \
  "$OUT" "$(wc -c <"$OUT.svg" | tr -d ' ')" "$(gzip -9c "$OUT.svg" | wc -c | tr -d ' ')" "$OUT" "$(printf '%.0f' "$ELEV")"

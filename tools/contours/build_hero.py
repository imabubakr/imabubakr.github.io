"""Inject the hero map, graticule, coordinates and map-collar values into HTML.

Reads the metadata written by make_contours.sh, draws the graticule in the same
projected frame as the contours (so meridians carry their true grid convergence),
and replaces the content between marker comments in each HTML file:

    <!-- build:hero-map -->     inline contour + graticule SVGs
    <!-- build:hero-strip -->   longitude ticks/labels for the top neatline strip
    <!-- build:hero-coords -->  "47.9978°N 7.8426°E  h 277 m"
    <!-- build:collar -->       CRS, contour interval, DEM credit, revision

Each marker is closed by <!-- /build:name -->.

Usage: python3 tools/contours/build_hero.py index.html [more.html ...]
"""

import datetime
import json
import math
import re
import sys
from pathlib import Path

import numpy as np
from osgeo import osr

osr.UseExceptions()

ROOT = Path(__file__).resolve().parents[2]
META = ROOT / "assets/topo/hero-contours.json"
CONTOURS = ROOT / "assets/topo/hero-contours.svg"

MERIDIAN_STEP = 2 / 60  # labelled meridians every 2'
TICK_STEP = 0.5 / 60  # minor ticks every 30"

DEM_CREDIT = {
    "Copernicus DEM GLO-30": (
        "DEM: Copernicus GLO-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018 "
        "provided under COPERNICUS by the European Union and ESA; all rights reserved"
    ),
}


def dms(value, pos, neg):
    hemi = pos if value >= 0 else neg
    total = round(abs(value) * 120) / 2  # nearest 30" in minutes
    deg, minutes = divmod(total, 60)
    sec = "30″" if minutes % 1 else ""
    return f"{int(deg)}°{int(minutes):02d}′{sec}{hemi}"


def multiples(lo, hi, step):
    return [k * step for k in range(math.ceil(lo / step - 1e-9), math.floor(hi / step + 1e-9) + 1)]


def main(html_files):
    meta = json.loads(META.read_text())
    xmin, ymin, xmax, ymax = meta["bbox"]
    width, height = xmax - xmin, ymax - ymin

    utm = osr.SpatialReference()
    utm.ImportFromEPSG(meta["epsg"])
    wgs = osr.SpatialReference()
    wgs.ImportFromEPSG(4326)
    wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    fwd = osr.CoordinateTransformation(wgs, utm)
    inv = osr.CoordinateTransformation(utm, wgs)

    def svg_xy(lon, lat):
        x, y = fwd.TransformPoint(lon, lat)[:2]
        return x - xmin, ymax - y

    corners = [inv.TransformPoint(x, y)[:2] for x in (xmin, xmax) for y in (ymin, ymax)]
    lon_lo, lon_hi = min(c[0] for c in corners), max(c[0] for c in corners)
    lat_lo, lat_hi = min(c[1] for c in corners), max(c[1] for c in corners)

    # Meridians: x where each one crosses the top (y=0) and bottom (y=H) of the frame.
    def meridian(lon):
        pts = np.array([svg_xy(lon, lat) for lat in np.linspace(lat_lo - 0.02, lat_hi + 0.02, 40)])
        order = np.argsort(pts[:, 1])
        return (float(np.interp(0, pts[order, 1], pts[order, 0])),
                float(np.interp(height, pts[order, 1], pts[order, 0])))

    # Parallels: y where each one crosses the left (x=0) and right (x=W) edges.
    def parallel(lat):
        pts = np.array([svg_xy(lon, lat) for lon in np.linspace(lon_lo - 0.02, lon_hi + 0.02, 40)])
        order = np.argsort(pts[:, 0])
        return (float(np.interp(0, pts[order, 0], pts[order, 1])),
                float(np.interp(width, pts[order, 0], pts[order, 1])))

    meridians = [(lon, *meridian(lon)) for lon in multiples(lon_lo, lon_hi, MERIDIAN_STEP)]
    meridians = [m for m in meridians if 0 < m[1] < width]

    # Edge ticks for latitude, every 30", longer on whole minutes.
    edge_ticks = []
    for lat in multiples(lat_lo, lat_hi, TICK_STEP):
        y_left, y_right = parallel(lat)
        if not (0 < y_left < height):
            continue
        length = 90 if abs(lat * 60 - round(lat * 60)) < 1e-6 else 45
        edge_ticks.append(f"M0 {y_left:.0f}h{length}M{width:.0f} {y_right:.0f}h-{length}")

    mx, my = svg_xy(meta["lon"], meta["lat"])
    graticule = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.0f} {height:.0f}" '
        f'aria-hidden="true" focusable="false" class="grat">'
        f'<path class="grat-m" d="{"".join(f"M{top:.0f} 0L{bottom:.0f} {height:.0f}" for _, top, bottom in meridians)}"/>'
        f'<path class="grat-t" d="{"".join(edge_ticks)}"/>'
        f'<g class="grat-mark" transform="translate({mx:.0f} {my:.0f})">'
        f'<rect x="-24" y="-24" width="48" height="48" transform="rotate(45)"/><circle r="8"/></g>'
        "</svg>"
    )
    contours = re.sub(r"<style>.*?</style>", "", CONTOURS.read_text(), flags=re.S)
    hero_map = f'<div class="map-box">{contours}{graticule}</div>'

    # Top strip: ticks every 30" positioned by their x at the top edge (fraction of width).
    strip = []
    for lon in multiples(lon_lo, lon_hi, TICK_STEP):
        top, _ = meridian(lon)
        fx = top / width
        if not 0.02 < fx < 0.98:
            continue
        minutes = lon * 60
        # Labels near the ends would collide with the sheet number / CRS.
        if abs(minutes / 2 - round(minutes / 2)) < 1e-6 and 0.1 < fx < 0.88:
            strip.append(f'<span class="tick tick--major" style="--fx:{fx:.4f}"><span>{dms(lon, "E", "W")}</span></span>')
        elif abs(minutes / 2 - round(minutes / 2)) < 1e-6 or abs(minutes - round(minutes)) < 1e-6:
            strip.append(f'<span class="tick tick--minute" style="--fx:{fx:.4f}"></span>')
        else:
            strip.append(f'<span class="tick" style="--fx:{fx:.4f}"></span>')

    coords = (
        f'{abs(meta["lat"]):.4f}°{"N" if meta["lat"] >= 0 else "S"} '
        f'{abs(meta["lon"]):.4f}°{"E" if meta["lon"] >= 0 else "W"}'
        f'<span class="sep"> </span>h {meta["elevation_m"]} m'
    )

    utm_label = meta["crs"].replace("zone ", "")  # "WGS 84 / UTM 32N"
    credit = DEM_CREDIT.get(meta["dem"], f'DEM: {meta["dem"]}')
    collar = (
        f'<span class="collar-item">{utm_label}</span>'
        f'<span class="collar-item">CI {meta["contour_interval_m"]} m</span>'
        f'<span class="collar-item">rev. {datetime.date.today():%Y-%m}</span>'
        f'<span class="collar-credit">{credit}</span>'
    )

    blocks = {
        "hero-map": hero_map,
        "hero-strip": "".join(strip),
        "hero-coords": coords,
        "collar": collar,
    }
    for name in html_files:
        path = Path(name)
        html = path.read_text()
        for key, content in blocks.items():
            html = re.sub(
                rf"(<!-- build:{key} -->).*?(<!-- /build:{key} -->)",
                lambda m: m.group(1) + content + m.group(2),
                html,
                flags=re.S,
            )
        html = re.sub(r'--map-width-m:\s*[\d.]+', f'--map-width-m: {width:.0f}', html)
        path.write_text(html)
        print(f"updated {path}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])

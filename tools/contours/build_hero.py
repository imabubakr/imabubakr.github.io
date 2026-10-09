"""Inject the hero map, graticule, coordinates and map-collar values into HTML.

Reads the metadata written by make_contours.sh, draws the graticule in the same
projected frame as the contours (so meridians carry their true grid convergence),
and replaces the content between marker comments in each HTML file:

    <!-- build:hero-map -->     inline contour + graticule SVGs
    <!-- build:hero-strip -->   longitude ticks/labels for the top neatline strip
    <!-- build:hero-place -->   "Freiburg im Breisgau" map label at the Münster
    <!-- build:credit -->       DEM licence credit

Each marker is closed by <!-- /build:name -->.

Usage: python3 tools/contours/build_hero.py index.html [more.html ...]
"""

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

PLACE = ("Freiburg im Breisgau", 7.8522, 47.9956)  # name, Münster lon/lat
MERIDIAN_STEP = 2 / 60  # labelled meridians every 2'
TICK_STEP = 1 / 60  # strip ticks every minute

# The Copernicus DEM licence prescribes this statement verbatim (in English).
DEM_STATEMENT = {
    "Copernicus DEM GLO-30": (
        "Copernicus GLO-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018 "
        "provided under COPERNICUS by the European Union and ESA; all rights reserved"
    ),
}

# Per-language notation: hemisphere letters, decimal separator, collar wording.
LOCALES = {
    "en": {"E": "E", "W": "W", "N": "N", "S": "S", "dec": ".", "ci": "CI", "dem": "DEM"},
    "de": {"E": "O", "W": "W", "N": "N", "S": "S", "dec": ",", "ci": "Äquidistanz", "dem": "Höhenmodell"},
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

    meridians = [(lon, *meridian(lon)) for lon in multiples(lon_lo, lon_hi, MERIDIAN_STEP)]
    meridians = [m for m in meridians if 0 < m[1] < width]

    graticule = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.0f} {height:.0f}" '
        f'aria-hidden="true" focusable="false" class="grat">'
        f'<path class="grat-m" d="{"".join(f"M{top:.0f} 0L{bottom:.0f} {height:.0f}" for _, top, bottom in meridians)}"/>'
        "</svg>"
    )
    contours = re.sub(r"<style>.*?</style>", "", CONTOURS.read_text(), flags=re.S)
    hero_map = f'<div class="map-box">{contours}{graticule}</div>'

    # Top strip: ticks every minute positioned by their x at the top edge (fraction of width).
    ticks = []
    for lon in multiples(lon_lo, lon_hi, TICK_STEP):
        top, _ = meridian(lon)
        fx = top / width
        if 0.02 < fx < 0.98:
            # Labels near the ends would collide with the sheet number / CRS.
            labelled = abs(lon * 30 - round(lon * 30)) < 1e-6 and 0.1 < fx < 0.88
            ticks.append((lon, fx, labelled))

    # Town label at its true position, as a fraction of the map (like the strip ticks).
    px, py = svg_xy(*PLACE[1:])
    place = (f'<span class="hero-place" style="--fx:{px / width:.4f};--fy:{py / height:.4f}">'
             f'<span class="hero-place-name">{PLACE[0]}</span></span>')


    def blocks_for(lang):
        loc = LOCALES.get(lang, LOCALES["en"])
        strip = "".join(
            f'<span class="tick tick--major" style="--fx:{fx:.4f}"><span>{dms(lon, loc["E"], loc["W"])}</span></span>'
            if labelled else f'<span class="tick" style="--fx:{fx:.4f}"></span>'
            for lon, fx, labelled in ticks
        )
        statement = DEM_STATEMENT.get(meta["dem"], meta["dem"])
        return {
            "hero-map": hero_map,
            "hero-strip": strip,
            "hero-place": place,
            "credit": f'{loc["dem"]}: <span lang="en">{statement}</span>' if lang != "en" else f"{loc['dem']}: {statement}",
        }

    for name in html_files:
        path = Path(name)
        html = path.read_text()
        lang = re.search(r'<html[^>]*\blang="([a-z]+)', html)
        blocks = blocks_for(lang.group(1) if lang else "en")
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

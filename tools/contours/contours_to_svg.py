"""Turn simplified contour GeoJSON (projected, metres) into the hero SVG.

Intermediate and index contours each become one compound <path>. Index contours
get elevation labels placed on straight stretches, spaced apart, and rotated so
the top of each number faces uphill (topographic map convention). The knockout
behind a label is a paper-coloured stroke drawn under the glyphs
(paint-order: stroke), so the contour line appears broken around the number.
"""

import argparse
import json
import math

import numpy as np
from osgeo import gdal

gdal.UseExceptions()


def parse_args():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--contours", required=True)
    p.add_argument("--dem", required=True, help="DEM used to orient labels uphill")
    p.add_argument("--bbox", required=True, nargs=4, type=float, metavar=("XMIN", "YMIN", "XMAX", "YMAX"))
    p.add_argument("--out", required=True)
    p.add_argument("--min-length", type=float, default=150, help="drop contour pieces shorter than this (m)")
    p.add_argument("--min-ring", type=float, default=700,
                   help="drop closed contours shorter than this (m): DSM noise from buildings and trees")
    p.add_argument("--label-px", type=float, default=10, help="label size in px at the reference width")
    p.add_argument("--ref-width-px", type=float, default=1440, help="viewport width the label size is tuned for")
    p.add_argument("--label-spacing", type=float, default=2200, help="distance between labels along a line (m)")
    p.add_argument("--label-separation", type=float, default=900, help="minimum distance between any two labels (m)")
    p.add_argument("--max-labels", type=int, default=16)
    return p.parse_args()


def lines_of(geometry):
    if geometry is None:
        return []
    if geometry["type"] == "LineString":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiLineString":
        return geometry["coordinates"]
    return []


def line_length(pts):
    return float(np.sum(np.hypot(*np.diff(pts, axis=0).T)))


class Dem:
    def __init__(self, path):
        ds = gdal.Open(path)
        self.arr = ds.GetRasterBand(1).ReadAsArray().astype(float)
        self.gt = ds.GetGeoTransform()

    def at(self, x, y):
        col = int((x - self.gt[0]) / self.gt[1])
        row = int((y - self.gt[3]) / self.gt[5])
        row = min(max(row, 0), self.arr.shape[0] - 1)
        col = min(max(col, 0), self.arr.shape[1] - 1)
        return self.arr[row, col]


def point_at(pts, cum, d):
    i = int(np.searchsorted(cum, d)) - 1
    i = min(max(i, 0), len(pts) - 2)
    t = (d - cum[i]) / max(cum[i + 1] - cum[i], 1e-9)
    return pts[i] + t * (pts[i + 1] - pts[i])


def place_labels(index_lines, dem, bbox, size_m, args):
    xmin, ymin, xmax, ymax = bbox
    margin = size_m * 2.5
    half = size_m * 1.6  # roughly half the width of a 3-4 digit label plus padding
    placed = []
    for elev, pts in sorted(index_lines, key=lambda l: -line_length(l[1])):
        cum = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(pts, axis=0).T))])
        total = cum[-1]
        if total < 3 * half:
            continue
        d = min(args.label_spacing / 2, total / 2)
        while d < total - half and len(placed) < args.max_labels:
            a, p, b = point_at(pts, cum, d - half), point_at(pts, cum, d), point_at(pts, cum, d + half)
            d += args.label_spacing
            if not (xmin + margin < p[0] < xmax - margin and ymin + margin < p[1] < ymax - margin):
                continue
            v1, v2 = p - a, b - p
            bend = abs(math.degrees(math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1 @ v2)))
            if bend > 18:
                continue
            if any(math.dist(p, q) < args.label_separation for q, _, _ in placed):
                continue
            # Map y points north, SVG y points down: flip the tangent's y.
            theta = math.degrees(math.atan2(-(b[1] - a[1]), b[0] - a[0]))
            # The glyphs' "up" in map coordinates is (sin t, cos t); turn it to face uphill.
            up = np.array([math.sin(math.radians(theta)), math.cos(math.radians(theta))])
            if dem.at(*(p + 40 * up)) < dem.at(*(p - 40 * up)):
                theta += 180
            theta = (theta + 180) % 360 - 180
            placed.append((p, theta, elev))
    return placed


def main():
    args = parse_args()
    xmin, ymin, xmax, ymax = args.bbox
    width, height = xmax - xmin, ymax - ymin
    size_m = args.label_px * width / args.ref_width_px
    dem = Dem(args.dem)

    with open(args.contours) as f:
        features = json.load(f)["features"]

    def to_svg(x, y):
        return round(x - xmin), round(ymax - y)

    paths = {False: [], True: []}
    index_lines = []
    for feat in features:
        is_index = bool(feat["properties"].get("index"))
        for coords in lines_of(feat["geometry"]):
            pts = np.asarray(coords, dtype=float)[:, :2]
            if len(pts) < 2:
                continue
            closed = np.allclose(pts[0], pts[-1])
            if line_length(pts) < (args.min_ring if closed else args.min_length):
                continue
            svg_pts = [to_svg(x, y) for x, y in pts]
            svg_pts = [p for i, p in enumerate(svg_pts) if i == 0 or p != svg_pts[i - 1]]
            if len(svg_pts) < 2:
                continue
            paths[is_index].append(
                "M" + "L".join(f"{x} {y}" for x, y in svg_pts)
            )
            if is_index:
                index_lines.append((int(feat["properties"]["elev"]), pts))

    labels = place_labels(index_lines, dem, args.bbox, size_m, args)

    fs = round(size_m)
    halo = round(size_m * 0.45)
    style = (
        ".topo-c,.topo-i{fill:none;stroke:var(--contour,#8A6A4A);stroke-linejoin:round;vector-effect:non-scaling-stroke}"
        ".topo-c{stroke-width:.5px}"
        ".topo-i{stroke-width:1.3px}"
        f".topo-l{{fill:var(--contour,#8A6A4A);font-family:var(--font-mono,'IBM Plex Mono',ui-monospace,monospace);"
        f"font-size:{fs}px;font-weight:500;text-anchor:middle;dominant-baseline:central;"
        f"paint-order:stroke;stroke:var(--paper,#E9EAE6);stroke-width:{halo}px;stroke-linejoin:round}}"
    )
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {round(width)} {round(height)}" '
        f'preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" class="topo">',
        f"<style>{style}</style>",
        f'<path class="topo-c" d="{"".join(paths[False])}"/>',
        f'<path class="topo-i" d="{"".join(paths[True])}"/>',
        '<g class="topo-l">',
        *(
            f'<text transform="translate({x} {y}) rotate({theta:.0f})">{elev}</text>'
            for (x, y), theta, elev in ((to_svg(*p), t, e) for p, t, e in labels)
        ),
        "</g>",
        "</svg>",
    ]
    with open(args.out, "w") as f:
        f.write("\n".join(out))
    print(f"{len(paths[False])} intermediate, {len(paths[True])} index pieces, {len(labels)} labels")


if __name__ == "__main__":
    main()

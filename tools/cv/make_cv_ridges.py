#!/usr/bin/env python3
"""Ridge lines for the PDF/print CV header (assets/topo/cv-ridges.svg), as in the hero's "ridges" view.

    python3 tools/cv/make_cv_ridges.py          # needs numpy

From the hero's 50 m elevation grid (assets/topo/hero-contours-dem.bin, 200 x 100 cells, the same 10 x 5 km as
the hero map): one line every ROW_STEP grid rows from north (back, top) to south (front, bottom), each lifted by
its elevation, drawn back to front with a white fill below it so nearer ridges hide farther ones. Flat over the
Rhine plain on the left (behind the name), rising into the Black Forest on the right (behind the QR code).
Owner, 2026-10-14: ridge lines across the whole header instead of the faint contour crop.
"""
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DEM = ROOT / "assets" / "topo" / "hero-contours-dem.bin"
OUT = ROOT / "assets" / "topo" / "cv-ridges.svg"
W, H = 1000, 210                 # viewBox; the header is about 4.7 : 1
ROW_STEP = 6                     # grid rows between ridge lines (300 m)
TOP, GAP, LIFT = 70, 8.5, 95     # first baseline, baseline step, height of the highest point above its baseline

z = np.fromfile(DEM, "<i2").reshape(100, 200).astype(float)
k = np.array([1, 4, 6, 4, 1], float); k /= k.sum()     # a light smoothing along each line
zmin, zmax = np.percentile(z, 2), z.max()
paths = []
for i, j in enumerate(range(2, 100, ROW_STEP)):
    row = np.convolve(np.pad(z[j], 2, mode="edge"), k, "valid")
    base = TOP + i * GAP
    xs = np.linspace(0, W, row.size)
    ys = base - np.clip(row - zmin, 0, None) / (zmax - zmin) * LIFT
    line = " L".join(f"{x:.1f} {y:.1f}" for x, y in zip(xs, ys))
    paths.append(f'<path class="f" d="M{line} L{W} {H} L0 {H}Z"/><path class="s" d="M{line}"/>')   # fill hides, line draws
OUT.write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="none">'
               '<style>.f{fill:#fff}.s{fill:none;stroke:#8a6a4a;stroke-width:1.1;stroke-linejoin:round;'
               'vector-effect:non-scaling-stroke}</style>' + "".join(paths) + "</svg>")
print(f"{OUT.name}: {len(paths)} ridge lines, {OUT.stat().st_size / 1024:.0f} KB")

"""Pre-render the "Light and water" map (light theme, sun from the north-west at 35°,
no water) as assets/layers/terrain-poster.webp. Shown before assets/js/terrain.js has
loaded the elevation grid, and without JavaScript. Same shading as the script.

Run from the repo root after the region map exists: python3 tools/layers/build_terrain_poster.py
"""

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
META = ROOT / "assets/topo/region-contours.json"
OUT = ROOT / "assets/layers/terrain-poster.webp"

PAPER, INK, TINT = (0xE9, 0xEA, 0xE6), (0x14, 0x17, 0x19), (0x8A, 0x6A, 0x4A)
Z, AZ, ALT = 2, 315, 35


def main():
    meta = json.loads(META.read_text())
    g = meta["grid"]
    cols, rows, cell = g["cols"], g["rows"], g["cell_m"][0]
    h = np.frombuffer((META.parent / g["file"]).read_bytes(), dtype="<i2").reshape(rows, cols).astype(float)

    dzdx = Z * np.gradient(h, axis=1) / cell
    dzdy = Z * np.gradient(h, axis=0) / cell
    az, alt = math.radians(AZ), math.radians(ALT)
    lx, ly, lz = math.sin(az) * math.cos(alt), -math.cos(az) * math.cos(alt), math.sin(alt)
    shade = np.clip((-dzdx * lx - dzdy * ly + lz) / np.sqrt(dzdx ** 2 + dzdy ** 2 + 1), 0, None)

    # cast shadows, vectorised over all cells
    dx, dy = math.sin(az), -math.cos(az)
    m = max(abs(dx), abs(dy))
    dx, dy = dx / m, dy / m
    rise = math.tan(alt) * cell * math.hypot(dx, dy)
    rr, cc = np.mgrid[0:rows, 0:cols].astype(float)
    z = h.copy()
    shadow = np.zeros_like(h, dtype=bool)
    active = np.ones_like(h, dtype=bool)
    x, y = cc.copy(), rr.copy()
    hmax = h.max()
    while active.any():
        x += dx
        y += dy
        z += rise
        inside = (x >= 0) & (y >= 0) & (x <= cols - 1) & (y <= rows - 1) & (z <= hmax)
        active &= inside
        xi = np.clip(np.round(x).astype(int), 0, cols - 1)
        yi = np.clip(np.round(y).astype(int), 0, rows - 1)
        hit = active & (h[yi, xi] > z)
        shadow |= hit
        active &= ~hit
    s = shade * np.where(shadow, 0.4, 1)

    t1 = np.minimum(1, (1 - s) * 1.25) * 0.5
    t2 = np.maximum(0, 0.55 - s) * 0.9
    img = np.zeros((rows, cols, 3))
    for k in range(3):
        v = PAPER[k] + (TINT[k] - PAPER[k]) * t1
        img[..., k] = v + (INK[k] - v) * t2
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).resize((800, 720), Image.LANCZOS)
    im.save(OUT, quality=78, method=6)
    print(f"{OUT.name}: {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()

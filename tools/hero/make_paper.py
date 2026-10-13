#!/usr/bin/env python3
"""Textures for the hero's "old folded survey sheet" look (experiment).

    python3 tools/hero/make_paper.py          # needs numpy and Pillow

Models the opened sheet as a height field: accordion folds that are not quite
straight or even (a few px of wobble, a slight tilt, strength varying along the
fold), panels that no longer lie flat, a handful of short handling wrinkles and
a faint crumple. It is lit like a hillshade (sun top left) and written as three
images per format to assets/img/:

  paper-<fmt>-relief.webp  grey, 128 = flat; laid over the hero with soft-light
  paper-<fmt>-wear.webp    alpha mask: ink rubbed off along the folds (mountain
                           folds more, worn spots where folds cross)
  paper-<fmt>-age.webp     alpha mask: yellowing, browned edges, foxing spots, a
                           faint tide mark, grime in the valley folds

Colours stay in CSS (--paper, --sheet-age); the images carry only shape.
<fmt> is "wide" (desktop, 4 x 2 panels) or "tall" (phones, 2 x 3 panels).
"""
from pathlib import Path

import sys

import numpy as np
from PIL import Image

OUT = Path(__file__).resolve().parents[2] / "assets" / "img"
FORMATS = {
    # name: (width, height, vertical folds [(x fraction, +1 mountain / -1 valley)], horizontal folds)
    "wide": (2000, 1000, [(0.25, 1), (0.5, -1), (0.75, 1)], [(0.5, -1)]),
    "tall": (800, 1300, [(0.5, 1)], [(1 / 3, -1), (2 / 3, 1)]),
}
rng = np.random.default_rng(20261010)


def noise2d(w, h, cell, octaves=3):
    """Smooth value noise in 0..1 (bicubic-upscaled random grids)."""
    acc, amp, tot = np.zeros((h, w)), 1.0, 0.0
    for o in range(octaves):
        c = max(2, int(cell / 2 ** o))
        g = rng.random((h // c + 3, w // c + 3)).astype(np.float32)
        im = Image.fromarray(g, "F").resize(((w // c + 3) * c, (h // c + 3) * c), Image.BICUBIC)
        acc += amp * np.asarray(im)[c:c + h, c:c + w]
        tot += amp
        amp *= 0.5
    acc /= tot
    return (acc - acc.min()) / (np.ptp(acc) + 1e-9)


def noise1d(n, cell):
    g = rng.random(n // cell + 4)
    x = np.arange(n) / cell + 1
    i = x.astype(int)
    t = x - i
    t = t * t * (3 - 2 * t)
    return g[i] * (1 - t) + g[i + 1] * t


def blur(a, r):
    """Separable Gaussian blur, sigma r px (edges clamped)."""
    k = np.exp(-0.5 * (np.arange(-int(3 * r + 1), int(3 * r + 1) + 1) / r) ** 2)
    k /= k.sum()
    p = len(k) // 2
    a = np.pad(a, p, mode="edge")
    a = np.apply_along_axis(lambda v: np.convolve(v, k, "valid"), 1, a)
    return np.apply_along_axis(lambda v: np.convolve(v, k, "valid"), 0, a)


def make(name, W, H, vfolds, hfolds):
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    h = np.zeros((H, W), np.float32)       # height
    wear = np.zeros((H, W), np.float32)    # ink rubbed off
    age = np.zeros((H, W), np.float32)     # discolouration
    lines = []                             # (distance field, sign) per fold

    def fold(d, along, n, sign):
        s = 0.7 + 0.45 * noise1d(n, 140)[along]                # strength varies along the fold
        h[:] += sign * s * (1.0 * np.exp(-np.abs(d) / 2.5)     # the sharp crease
                            + 2.6 * np.exp(-np.abs(d) / 55))   # the panel bending into it
        patchy = np.clip(noise1d(n, 26)[along] * 1.7 - 0.45, 0, 1)
        wear[:] = np.maximum(wear, (0.95 if sign > 0 else 0.45) * s * patchy * np.exp(-np.abs(d) / 3.5))
        if sign < 0:                                           # dirt settles in valley folds
            age[:] += 0.45 * s * np.exp(-np.abs(d) / 5)
        lines.append(d)

    for fx, sign in vfolds:
        x0 = fx * W + rng.uniform(-6, 6)
        tilt = np.tan(np.radians(rng.uniform(-0.3, 0.3)))
        wob = (noise1d(H, 180) - 0.5) * 5
        d = xx - (x0 + tilt * (yy - H / 2) + wob[yy.astype(int)])
        fold(d, yy.astype(int), H, sign)
    for fy, sign in hfolds:
        y0 = fy * H + rng.uniform(-5, 5)
        tilt = np.tan(np.radians(rng.uniform(-0.3, 0.3)))
        wob = (noise1d(W, 180) - 0.5) * 5
        d = yy - (y0 + tilt * (xx - W / 2) + wob[xx.astype(int)])
        fold(d, xx.astype(int), W, sign)

    # where folds cross the paper is weakest: a small pucker, worn and grubby
    for dv in lines[:len(vfolds)]:
        for dh in lines[len(vfolds):]:
            r = np.hypot(dv, dh)
            h += 0.5 * np.exp(-r / 9) * (rng.random() - 0.5)
            wear[:] = np.maximum(wear, 0.85 * np.exp(-(r / 13) ** 2))
            age[:] += 0.18 * np.exp(-(r / 30) ** 2)

    # short handling wrinkles
    for _ in range(int(W * H / 160000)):
        cx, cy = rng.uniform(0, W), rng.uniform(0, H)
        a, L = rng.uniform(0, np.pi), rng.uniform(50, 220)
        u = (xx - cx) * np.cos(a) + (yy - cy) * np.sin(a)
        v = -(xx - cx) * np.sin(a) + (yy - cy) * np.cos(a)
        taper = np.clip(1 - (u / (L / 2)) ** 2, 0, 1)
        h += rng.choice([-1, 1]) * rng.uniform(0.15, 0.35) * taper * (np.exp(-np.abs(v) / 1.8) + 0.8 * np.exp(-np.abs(v) / 16))
    h += 0.6 * (noise2d(W, H, 90) - 0.5)                         # faint crumple

    # hillshade, sun from the top left
    gy, gx = np.gradient(blur(h, 0.6) * 3.0)
    n = np.dstack([-gx, -gy, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    sun = np.array([-1.0, -1.25, 1.1])
    sun /= np.linalg.norm(sun)
    shade = n @ sun - sun[2]                                     # 0 on flat paper
    relief = np.clip(128 + shade * 230, 0, 255).astype(np.uint8)

    # ageing: overall yellowing (uneven), browned edges, foxing, one faint tide mark
    edge = np.minimum.reduce([xx, W - 1 - xx, yy, H - 1 - yy])
    ragged = noise2d(W, H, 60)
    age += 0.32 + 0.2 * (noise2d(W, H, 400) - 0.5)
    age += 0.6 * np.exp(-edge / (35 + 45 * ragged))
    for _ in range(int(W * H / 45000)):                          # foxing spots
        cx, cy, r = rng.uniform(0, W), rng.uniform(0, H), rng.uniform(1.2, 6) ** 1.25
        age += rng.uniform(0.25, 0.7) * np.exp(-(np.hypot(xx - cx, yy - cy) / r) ** 2)
    cx, cy, R = W * rng.uniform(0.62, 0.85), H * rng.uniform(0.2, 0.4), min(W, H) * 0.13
    rr = np.hypot(xx - cx, yy - cy) * (1 + 0.08 * (noise2d(W, H, 40) - 0.5))
    age += 0.22 * np.exp(-((rr - R) / 2.2) ** 2) + 0.05 * (rr < R)
    age = blur(age, 0.8)

    def alpha(m):
        a = (np.clip(m, 0, 1) * 255).astype(np.uint8)
        return Image.merge("RGBA", [Image.new("L", (W, H), 255)] * 3 + [Image.fromarray(a)])

    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(relief, "L").save(OUT / f"paper-{name}-relief.webp", quality=82, method=6)
    alpha(wear).save(OUT / f"paper-{name}-wear.webp", quality=80, alpha_quality=70, method=6)
    alpha(age).save(OUT / f"paper-{name}-age.webp", quality=80, alpha_quality=55, method=6)
    for k in ("relief", "wear", "age"):
        p = OUT / f"paper-{name}-{k}.webp"
        print(f"{p.relative_to(OUT.parents[1])}: {p.stat().st_size / 1024:.0f} KB")


# PREVIEW (2026-10-13): python3 tools/hero/make_paper.py --preview writes fold variants for the wide sheet to
# assets/img/preview/ (committed while the choice is open): 3x2 (folds at the thirds and the middle) and 3x1 (two folds at the thirds)
if "--preview" in sys.argv:
    OUT = OUT / "preview"
    for tag, v, hz in [("3x2", [(1 / 3, 1), (2 / 3, -1)], [(0.5, -1)]), ("3x1", [(1 / 3, 1), (2 / 3, -1)], [])]:
        rng = np.random.default_rng(20261010)
        make(f"wide-{tag}", 2000, 1000, v, hz)
else:
    for name, (W, H, v, hz) in FORMATS.items():
        make(name, W, H, v, hz)

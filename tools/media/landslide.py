"""Shallow-landslide scenario on real terrain (Freudenberg, NRW LiDAR), rendered
as a short video. A MODEL SCENARIO, not a recorded event.

Model
  terrain   2 m DTM from the LiDAR ground points (classes 2, 26), gaps filled
  stability infinite-slope model (Skempton & DeLory 1957):
              FS = [c' + (gamma - m*gamma_w) * z * cos^2(beta) * tan(phi')]
                   / [gamma * z * sin(beta) * cos(beta)]
            with soil depth z, slope beta and relative wetness m (0 dry ... 1 saturated)
  rain      m rises from 0 to 1 (a prolonged-rainfall scenario); cells with FS < 1 fail
  mass      volume = failed area * z, mass = volume * gamma / g
  runout    debris spreads downslope by multiple-flow-direction routing (Holmgren, x = 4)
            and stops where the travel angle from the top of the source drops below the
            empirical reach angle for its volume (Corominas 1996, all landslides):
              tan(alpha) = 0.97 * V^-0.105

    ~/miniforge3/envs/geoai/bin/python tools/media/landslide.py [--scan] [--preview]
      --scan     print FS statistics and candidate slopes, write work/ls_scan.png
      --preview  render a few frames only
Writes assets/plates/landslide-sim.{webm,mp4}, -720.webp and work/landslide.json (results).
"""
import glob
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

import laspy
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

HERE = Path(__file__).resolve().parent
WORK = HERE / "work"
ROOT = HERE.parents[1]
OUT = ROOT / "assets/plates"
CELL = 2.0
X0, Y1 = 420000.0, 5640000.0      # NW corner of the 2 x 2 km LiDAR block
N = 1000                          # 2000 m / 2 m

# soil and water (a typical weathered-slate colluvium of the Siegerland; scenario values)
C_EFF = 4.0e3        # effective cohesion c' incl. roots (Pa)
PHI = math.radians(33.0)
GAMMA = 19.0e3       # soil unit weight (N/m3)
GAMMA_W = 9.81e3     # water
Z_SOIL = 1.5         # soil depth (m)
G = 9.81


# ------------------------------------------------------------------ terrain --
def dtm():
    cache = WORK / "ls_dtm.npy"
    if cache.exists():
        return np.load(cache)
    zsum = np.zeros((N, N)); cnt = np.zeros((N, N))
    for f in sorted(glob.glob(str(WORK / "3dm_32_*.laz"))):
        with laspy.open(f) as r:
            for chunk in r.chunk_iterator(5_000_000):
                c = np.asarray(chunk.classification)
                g = (c == 2) | (c == 26)
                x = np.asarray(chunk.x)[g]; y = np.asarray(chunk.y)[g]; z = np.asarray(chunk.z)[g]
                col = ((x - X0) / CELL).astype(int); row = ((Y1 - y) / CELL).astype(int)
                ok = (col >= 0) & (col < N) & (row >= 0) & (row < N)
                np.add.at(zsum, (row[ok], col[ok]), z[ok]); np.add.at(cnt, (row[ok], col[ok]), 1)
        print("read", f)
    d = np.where(cnt > 0, zsum / np.maximum(cnt, 1), np.nan)
    idx = ndimage.distance_transform_edt(np.isnan(d), return_distances=False, return_indices=True)
    d = ndimage.gaussian_filter(d[tuple(idx)], 0.7)
    np.save(cache, d)
    return d


def slope_aspect(d):
    gy, gx = np.gradient(d, CELL)            # gy: d/drow (south), gx: d/dcol (east)
    beta = np.arctan(np.hypot(gx, gy))
    return beta, gx, gy


def hillshade(d, az=315, alt=40):
    gy, gx = np.gradient(d, CELL)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    a, al = math.radians(az), math.radians(alt)
    hs = np.sin(al) * np.cos(slope) + np.cos(al) * np.sin(slope) * np.cos(a - aspect)
    return np.clip(hs, 0, 1)


def factor_of_safety(beta, m):
    cb, sb = np.cos(beta), np.sin(beta)
    resist = C_EFF + (GAMMA - m * GAMMA_W) * Z_SOIL * cb * cb * math.tan(PHI)
    drive = GAMMA * Z_SOIL * sb * cb
    return np.where(drive > 1e-6, resist / np.maximum(drive, 1e-6), 99.0)


# ------------------------------------------------------------------- runout --
OFFS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def runout(d, source):
    """Multiple-flow-direction spreading from the source cells, limited by the
    Corominas reach angle. Returns (reach mask, path distance per cell, alpha, V)."""
    V = source.sum() * CELL * CELL * Z_SOIL
    tan_a = 0.97 * V ** -0.105
    ztop = d[source].max()
    rs, cs = np.nonzero(source)
    # visit cells in order of decreasing elevation (a flow only moves downhill)
    dist = np.full(d.shape, np.inf)
    dist[source] = 0.0
    weight = np.zeros(d.shape)
    weight[source] = 1.0
    r0, r1 = max(rs.min() - 400, 1), min(rs.max() + 400, d.shape[0] - 2)
    c0, c1 = max(cs.min() - 400, 1), min(cs.max() + 400, d.shape[1] - 2)
    sub = d[r0:r1, c0:c1]
    order = np.argsort(-sub, axis=None)
    for k in order:
        r, c = divmod(int(k), sub.shape[1])
        r += r0; c += c0
        w = weight[r, c]
        if w <= 1e-4:
            continue
        drops, tgt = [], []
        for dr, dc in OFFS:
            rr, cc = r + dr, c + dc
            step = CELL * (1.4142 if dr and dc else 1.0)
            dz = d[r, c] - d[rr, cc]
            if dz > 0:
                drops.append((dz / step) ** 4)       # Holmgren exponent x = 4
                tgt.append((rr, cc, step))
        if not drops:
            continue
        s = sum(drops)
        for p, (rr, cc, step) in zip(drops, tgt):
            nd = dist[r, c] + step
            # energy line: stop where the drop from the top over the path is flatter than alpha
            if (ztop - d[rr, cc]) / max(nd, 1e-6) < tan_a:
                continue
            weight[rr, cc] += w * p / s
            if nd < dist[rr, cc]:
                dist[rr, cc] = nd
    reach = np.isfinite(dist) & (weight > 0.002)
    return reach, np.where(reach, dist, np.nan), math.degrees(math.atan(tan_a)), V, weight


# -------------------------------------------------------------------- scan ---
def scan():
    d = dtm()
    beta, _, _ = slope_aspect(d)
    print("relief", float(np.nanmin(d)), float(np.nanmax(d)), "slope p50/p95/p99 deg",
          [round(float(np.degrees(np.percentile(beta, q))), 1) for q in (50, 95, 99)])
    for m in (0.0, 0.5, 1.0):
        fs = factor_of_safety(beta, m)
        print(f"m={m}: FS<1 on {100 * (fs < 1).mean():.2f} % of cells")
    fs = factor_of_safety(beta, 1.0)
    lab, n = ndimage.label(fs < 1)
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    top = np.argsort(-sizes)[:8]
    for i in top:
        rr, cc = np.nonzero(lab == i + 1)
        print(f"cluster {i + 1}: {int(sizes[i])} cells = {sizes[i] * CELL * CELL:.0f} m2 at "
              f"E {X0 + cc.mean() * CELL:.0f} N {Y1 - rr.mean() * CELL:.0f}")
    hs = hillshade(d)
    rgb = np.dstack([hs * 255] * 3).astype(np.uint8)
    rgb[fs < 1] = [220, 50, 30]
    Image.fromarray(rgb).save(WORK / "ls_scan.png")


if __name__ == "__main__" and "--scan" in sys.argv:
    scan()


# ------------------------------------------------------------------ render ---
W, H, FPS, SECONDS = 1600, 900, 30, 15
WIN_C = (420850.0, 5638610.0)     # window centre (E, N): the main unstable slope and its runout
WIN_W = 900.0                     # window width (m); height follows 16:9
SRC_HINT = (420907.0, 5638640.0)  # the scenario's landslide = the FS<1 cluster nearest to this
ACCENT = (210, 65, 15)
MONO = "/System/Library/Fonts/Menlo.ttc"


def smooth(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def window_slice():
    wh = WIN_W * H / W
    c0 = int((WIN_C[0] - WIN_W / 2 - X0) / CELL); c1 = int((WIN_C[0] + WIN_W / 2 - X0) / CELL)
    r0 = int((Y1 - (WIN_C[1] + wh / 2)) / CELL); r1 = int((Y1 - (WIN_C[1] - wh / 2)) / CELL)
    return slice(r0, r1), slice(c0, c1)


def fmt(v):  # thin-space thousands: valid in English and German (SI style)
    return f"{v:,.0f}".replace(",", " ")


def render(preview=False):
    d = dtm()
    beta, _, _ = slope_aspect(d)
    fs1 = factor_of_safety(beta, 1.0)
    # thin strips (road and building cuts) are not landslide sources: morphological opening
    lab, n = ndimage.label(ndimage.binary_opening(fs1 < 1, iterations=2))
    hr = int((Y1 - SRC_HINT[1]) / CELL); hc = int((SRC_HINT[0] - X0) / CELL)
    rr, cc = np.nonzero(lab > 0)
    k = np.argmin((rr - hr) ** 2 + (cc - hc) ** 2)
    source = lab == lab[rr[k], cc[k]]
    reach, dist, alpha, V, weight = runout(d, source)
    mass = V * GAMMA / G / 1000.0                     # tonnes
    # runout length L: horizontal distance from the crown (highest source cell) to the toe
    sr, sc = np.unravel_index(np.argmax(np.where(source, d, -np.inf)), d.shape)
    rr2, cc2 = np.nonzero(reach)
    toe = np.argmax(np.hypot(rr2 - sr, cc2 - sc))
    L = float(np.hypot(rr2[toe] - sr, cc2[toe] - sc) * CELL)
    H_drop = float(d[sr, sc] - d[rr2[toe], cc2[toe]])
    res = {"area_m2": float(source.sum() * CELL * CELL), "volume_m3": float(V), "mass_t": float(mass),
           "runout_m": L, "drop_m": H_drop, "reach_angle_deg": alpha,
           "params": {"c_kPa": C_EFF / 1e3, "phi_deg": math.degrees(PHI), "gamma_kN": GAMMA / 1e3,
                      "z_m": Z_SOIL, "cell_m": CELL}}
    (WORK / "landslide.json").write_text(json.dumps(res, indent=1))
    print(res)

    sl = window_slice()
    hs = hillshade(d)[sl]
    base = Image.fromarray((40 + hs * 200).astype(np.uint8)).convert("RGB").resize((W, H), Image.BICUBIC)
    beta_w = beta[sl]; src_w = source[sl]; wgt_w = weight[sl]
    dist_w = dist[sl]                 # the front advances along the flow paths (path length from the scar)
    dmax = float(np.nanmax(dist))
    up = lambda a: np.asarray(Image.fromarray(a.astype(np.float32)).resize((W, H), Image.BILINEAR))
    mono = lambda s: ImageFont.truetype(MONO, s)
    f_small, f_mid, f_big = mono(17), mono(20), mono(26)
    frames = WORK / "landslide_frames"
    shutil.rmtree(frames, ignore_errors=True); frames.mkdir(parents=True)
    n_frames = FPS * SECONDS
    picks = (0, 150, 240, 330, n_frames - 1)
    src_up = up(src_w.astype(np.float32)) > 0.5
    dist_up = up(np.nan_to_num(dist_w, nan=1e9))
    wgt_up = up(np.log1p(wgt_w * 50))
    wmax = float(np.percentile(wgt_up[wgt_up > 0], 99)) if (wgt_up > 0).any() else 1.0
    for i in range(n_frames):
        if preview and i not in picks:
            continue
        t = i / FPS
        m = smooth((t - 1.5) / 6.0)                   # 1.5 s ... 7.5 s: soil saturates
        fail = smooth((t - 8.0) / 0.8)                 # 8 s: failure
        flow = smooth((t - 9.0) / 3.5)                 # 9 ... 12.5 s: runout
        fs = up(factor_of_safety(beta_w, m))
        img = np.asarray(base).astype(np.float32)
        # FS: 1.5 ... 1.0 amber, < 1 red
        warn = np.clip((1.5 - fs) / 0.5, 0, 1)[..., None] * (fs >= 1)[..., None]
        # after the failure the other unstable cells step back, so the event stands out
        warn = warn * (1 - 0.6 * fail)
        img = img * (1 - 0.55 * warn) + np.array([235, 160, 40]) * 0.55 * warn
        bad = (fs < 1)[..., None] * (0.75 - 0.5 * fail)
        img = img * (1 - bad) + np.array([200, 40, 30]) * bad
        if fail > 0:                                  # the scenario's landslide: dark source scar
            s = src_up[..., None] * fail
            img = img * (1 - s) + np.array([90, 20, 15]) * s
        if flow > 0:                                  # runout front advances with path distance
            front = flow * dmax + 1.0
            on = (dist_up <= front) & (wgt_up > 0)
            inten = np.clip(wgt_up / wmax, 0.25, 1)[..., None] * on[..., None]
            img = img * (1 - 0.85 * inten) + np.array(ACCENT) * 0.85 * inten
        im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
        dr = ImageDraw.Draw(im, "RGBA")
        # panel: model, wetness, results (symbols and SI units only: works in both languages)
        dr.rectangle((24, 24, 640, 236 if t < 8 else 352), fill=(14, 18, 21, 205))
        dr.text((44, 40), "FS = [c′ + (γ − m·γw) z cos²β tanφ′] / (γ z sinβ cosβ)",
                font=f_small, fill=(228, 230, 231))
        dr.text((44, 74), f"c′ = {C_EFF / 1e3:.0f} kPa   φ′ = {math.degrees(PHI):.0f}°   z = {Z_SOIL:g} m".replace(".", " "[:0] or "."),
                font=f_small, fill=(141, 151, 158))
        dr.text((44, 112), "m", font=f_mid, fill=(228, 230, 231))
        dr.rectangle((84, 116, 444, 132), outline=(141, 151, 158, 255))
        dr.rectangle((84, 116, 84 + 360 * m, 132), fill=(70, 130, 180, 255))
        dr.text((460, 110), f"{m * 100:3.0f} %", font=f_mid, fill=(228, 230, 231))
        unstable = float((factor_of_safety(beta_w, m) < 1).sum() * CELL * CELL)
        dr.rectangle((44, 158, 62, 176), fill=(200, 40, 30, 255)); dr.text((74, 156), "FS < 1", font=f_small, fill=(228, 230, 231))
        dr.rectangle((210, 158, 228, 176), fill=(235, 160, 40, 255)); dr.text((240, 156), "1 ≤ FS < 1,5" if False else "FS 1 … 1.5", font=f_small, fill=(228, 230, 231))
        dr.text((44, 196), f"FS < 1: {fmt(unstable)} m²", font=f_mid, fill=(228, 230, 231))
        if t >= 8:
            a = int(255 * smooth((t - 8) / 0.6))
            dr.text((44, 236), f"V ≈ {fmt(round(V, -2))} m³", font=f_big, fill=(255, 106, 43, a))
            dr.text((44, 272), f"M ≈ {fmt(round(mass, -2))} t", font=f_big, fill=(228, 230, 231, a))
            if t >= 9:
                b = int(255 * smooth((t - 9) / 0.6))
                shown = min(L, flow * L)
                dr.text((44, 308), f"L ≈ {fmt(round(shown, -1))} m   α = {alpha:.0f}°", font=f_big, fill=(228, 230, 231, b))
        # scale bar (100 m) and north arrow
        px = 100.0 / WIN_W * W
        dr.rectangle((W - 60 - px, H - 52, W - 60, H - 46), fill=(14, 18, 21, 230))
        dr.text((W - 60 - px, H - 80), "100 m", font=f_small, fill=(14, 18, 21, 255))
        dr.polygon([(W - 40, 40), (W - 50, 70), (W - 40, 64), (W - 30, 70)], fill=(14, 18, 21, 230))
        dr.text((W - 46, 74), "N", font=f_small, fill=(14, 18, 21, 255))
        im.save(frames / f"{i:04d}.png")
        if i % 60 == 0:
            print("frame", i)
    if preview:
        return
    pat = str(frames / "%04d.png")
    run = lambda *a: subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *a], check=True)
    run("-framerate", str(FPS), "-i", pat, "-pix_fmt", "yuv420p", "-c:v", "libvpx-vp9", "-crf", "34", "-b:v", "0",
        "-row-mt", "1", str(OUT / "landslide-sim.webm"))
    run("-framerate", str(FPS), "-i", pat, "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:v", "libx264",
        "-preset", "slow", "-crf", "24", str(OUT / "landslide-sim.mp4"))
    Image.open(frames / f"{n_frames - 1:04d}.png").convert("RGB").resize((720, 405), Image.LANCZOS).save(
        OUT / "landslide-sim-720.webp", quality=80, method=6)
    print("done")


if __name__ == "__main__" and "--scan" not in sys.argv:
    render(preview="--preview" in sys.argv)

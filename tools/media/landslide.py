"""Shallow-landslide scenario on real terrain (Freudenberg, NRW LiDAR), rendered
in 3D. A MODEL SCENARIO with assumed soil and rain values, not a recorded event.

Model
  terrain    2 m DTM from the LiDAR ground points (classes 2, 26), gaps filled
  hydrology  steady-state shallow subsurface flow (Montgomery & Dietrich 1994;
             as in SHALSTAB / SINMAP):  m = min(1, q * a / (T * sin(beta)))
             q rainfall rate, a upslope area per unit contour width (MFD flow
             accumulation, Freeman p = 1.1), T soil transmissivity
  stability  infinite-slope model (Skempton & DeLory 1957):
             FS = [c' + (gamma - m*gamma_w) z cos^2(beta) tan(phi')] / [gamma z sin(beta) cos(beta)]
  failure    where FS < 1 at the peak rain; the scenario's slide is the compact
             cluster nearest SRC_HINT (thin road/building cuts removed by an opening)
  mass       V = A * z, M = V * gamma / g
  runout     Voellmy mass point along multiple-flow-direction paths (Holmgren x = 4):
             v2^2 = v1^2 + 2g (dz - mu * ds) - 2g ds v1^2 / xi ; stops where v = 0.
             Arrival time t += ds / v_mean. Cross-check: Corominas (1996)
             tan(alpha) = 0.97 V^-0.105.
  deposit    the volume is spread over the runout cells, more where the flow is slow
             (mass conserved); scar and deposit are drawn x VIS in 3D for visibility

    python landslide.py --scan                      FS statistics, work/ls_scan.png
    python landslide.py                              results, textures, panel layers, ls_*.bin
    node tools/media/render_landslide3d.mjs          3D frames (three.js, headless Chromium)
    python landslide.py --compose3d                  panel over the frames, encode
(python = ~/miniforge3/envs/geoai/bin/python)
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

# soil, water, rain (a weathered-slate colluvium of the Siegerland; scenario values)
C_EFF = 4.0e3        # effective cohesion c' incl. roots (Pa)
PHI = math.radians(33.0)
GAMMA = 19.0e3       # soil unit weight (N/m3)
GAMMA_W = 9.81e3
Z_SOIL = 1.5         # soil depth (m)
T_SOIL = 30.0        # transmissivity (m2/day)
Q_MAX = 0.150        # peak rainfall rate (m/day) = 150 mm/d: an extreme event (cf. July 2021)
MU, XI = 0.30, 300.0 # Voellmy friction and turbulence (m/s2)
G = 9.81
VIS = 3.0            # scar drawn this many times deeper in 3D
VIS_DEP = 1.5        # deposit drawn this many times thicker

OFFS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
STEP = [CELL * (1.4142 if dr and dc else 1.0) for dr, dc in OFFS]


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


def slope(d):
    gy, gx = np.gradient(d, CELL)
    return np.arctan(np.hypot(gx, gy))


def hillshade(d, az=315, alt=40):
    gy, gx = np.gradient(d, CELL)
    s = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    a, al = math.radians(az), math.radians(alt)
    return np.clip(np.sin(al) * np.cos(s) + np.cos(al) * np.sin(s) * np.cos(a - aspect), 0, 1)


def catchment(d):
    """Specific catchment area a (m): MFD flow accumulation (Freeman p = 1.1) / contour width."""
    cache = WORK / "ls_sca.npy"
    if cache.exists():
        return np.load(cache)
    acc = np.full(d.shape, CELL * CELL)
    nr, nc = d.shape
    for k in np.argsort(-d, axis=None):
        r, c = divmod(int(k), nc)
        if r == 0 or c == 0 or r == nr - 1 or c == nc - 1:
            continue
        z = d[r, c]
        w = []
        for (dr, dc), st in zip(OFFS, STEP):
            dz = z - d[r + dr, c + dc]
            w.append((dz / st) ** 1.1 if dz > 0 else 0.0)
        s = sum(w)
        if s <= 0:
            continue
        a = acc[r, c]
        for (dr, dc), wi in zip(OFFS, w):
            if wi:
                acc[r + dr, c + dc] += a * wi / s
    sca = acc / CELL
    np.save(cache, sca)
    print("catchment done")
    return sca


def wetness(beta, sca, q):
    return np.minimum(1.0, q * sca / (T_SOIL * np.maximum(np.sin(beta), 0.02)))


def factor_of_safety(beta, m):
    cb, sb = np.cos(beta), np.sin(beta)
    resist = C_EFF + (GAMMA - m * GAMMA_W) * Z_SOIL * cb * cb * math.tan(PHI)
    drive = GAMMA * Z_SOIL * sb * cb
    return np.where(drive > 1e-6, resist / np.maximum(drive, 1e-6), 99.0)


# ------------------------------------------------------------------- runout --
def runout(d, source):
    """Voellmy mass point on MFD paths: weight (spreading share), velocity and
    arrival time per cell. Cells are visited from high to low, so every cell has
    received all its inflow before it passes it on."""
    rs, cs = np.nonzero(source)
    r0, r1 = max(rs.min() - 300, 1), min(rs.max() + 300, d.shape[0] - 2)
    c0, c1 = max(cs.min() - 300, 1), min(cs.max() + 300, d.shape[1] - 2)
    weight = np.zeros(d.shape); v2 = np.full(d.shape, -1.0); tarr = np.full(d.shape, np.inf)
    weight[source] = 1.0; v2[source] = 0.0; tarr[source] = 0.0
    sub = d[r0:r1, c0:c1]
    for k in np.argsort(-sub, axis=None):
        r, c = divmod(int(k), sub.shape[1]); r += r0; c += c0
        w = weight[r, c]
        if w <= 1e-4 or v2[r, c] < 0:
            continue
        z, va = d[r, c], v2[r, c]
        tgt = []
        for (dr, dc), st in zip(OFFS, STEP):
            rr, cc = r + dr, c + dc
            dz = z - d[rr, cc]
            if dz <= 0:
                continue
            nv = va + 2 * G * (dz - MU * st) - 2 * G * st * va / XI
            if nv <= 0 and not source[rr, cc]:
                continue                         # the mass stops before this cell
            tgt.append((rr, cc, (dz / st) ** 4, max(nv, 0.0), st))
        s = sum(t[2] for t in tgt)
        for rr, cc, p, nv, st in tgt:
            weight[rr, cc] += w * p / s
            if nv > v2[rr, cc]:
                v2[rr, cc] = nv
            vm = 0.5 * (math.sqrt(va) + math.sqrt(nv))
            t = tarr[r, c] + st / max(vm, 0.3)
            if t < tarr[rr, cc]:
                tarr[rr, cc] = t
    reach = (weight > 0.002) & np.isfinite(tarr)
    return reach, weight, np.sqrt(np.maximum(v2, 0)), tarr


# --------------------------------------------------------------- particles --
def trajectories(d, source, n=6000, seed=3):
    """Debris particles for the 3D view: each starts on a random scar cell and
    walks downslope (neighbour chosen with probability ~ (tan slope)^4, as in the
    MFD routing), with the same Voellmy velocity update, until it stops.
    Returns a list of [(row, col, t), ...] in window-independent grid coordinates."""
    rng = np.random.default_rng(seed)
    rs, cs = np.nonzero(source)
    out = []
    for _ in range(n):
        k = rng.integers(len(rs))
        r, c = int(rs[k]), int(cs[k])
        jr, jc = rng.uniform(-0.5, 0.5, 2)
        v2, t = 0.0, rng.uniform(0, 0.8)           # small start-time spread: the slope breaks up
        path = [(r + jr, c + jc, t)]
        for _step in range(400):
            z = d[r, c]
            cand = []
            for (dr, dc), st in zip(OFFS, STEP):
                rr, cc = r + dr, c + dc
                if not (0 < rr < d.shape[0] - 1 and 0 < cc < d.shape[1] - 1):
                    continue
                dz = z - d[rr, cc]
                if dz > 0:
                    cand.append((rr, cc, (dz / st) ** 4, dz, st))
            if not cand:
                break
            p = np.array([x[2] for x in cand]); p /= p.sum()
            rr, cc, _, dz, st = cand[rng.choice(len(cand), p=p)]
            nv = v2 + 2 * G * (dz - MU * st) - 2 * G * st * v2 / XI
            if nv <= 0 and not source[rr, cc]:
                break
            nv = max(nv, 0.0)
            t += st / max(0.5 * (math.sqrt(v2) + math.sqrt(nv)), 0.3)
            v2, r, c = nv, rr, cc
            path.append((r + rng.uniform(-0.45, 0.45), c + rng.uniform(-0.45, 0.45), t))
        out.append(path)
    return out


# -------------------------------------------------------------------- scan ---
def scan():
    d = dtm(); beta = slope(d); sca = catchment(d)
    for q in (0.03, 0.06, Q_MAX):
        m = wetness(beta, sca, q)
        print(f"q={q * 1000:.0f} mm/d: mean m {m.mean():.2f}, FS<1 on {100 * (factor_of_safety(beta, m) < 1).mean():.2f} %")
    fs = factor_of_safety(beta, wetness(beta, sca, Q_MAX))
    hs = hillshade(d)
    rgb = np.dstack([hs * 255] * 3).astype(np.uint8)
    rgb[fs < 1] = [220, 50, 30]
    Image.fromarray(rgb).save(WORK / "ls_scan.png")


# ------------------------------------------------------------------ render ---
W, H, FPS, SECONDS = 1600, 900, 30, 17
WIN_C = (420850.0, 5638640.0)     # window centre (E, N)
WIN_W = 900.0
SRC_HINT = (420913.0, 5638707.0)
ACCENT = (210, 65, 15)
SCAR = (150, 112, 78)             # exposed ground in the scar
MONO = "/System/Library/Fonts/Menlo.ttc"
T_RAIN, T_FAIL, T_FLOW, T_FLOW_END = (1.5, 8.0), 8.5, 9.0, 14.5   # seconds in the video
RAMP_S = 2.5                      # a cell's deposit builds up over this much simulated time


def smooth(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def window_slice():
    wh = WIN_W * H / W
    c0 = int((WIN_C[0] - WIN_W / 2 - X0) / CELL); c1 = int((WIN_C[0] + WIN_W / 2 - X0) / CELL)
    r0 = int((Y1 - (WIN_C[1] + wh / 2)) / CELL); r1 = int((Y1 - (WIN_C[1] - wh / 2)) / CELL)
    return slice(r0, r1), slice(c0, c1)


def fmt(v):  # thin-space thousands (SI style, reads in English and German)
    return f"{v:,.0f}".replace(",", " ")


def simulate():
    d = dtm(); beta = slope(d); sca = catchment(d)
    fs_peak = factor_of_safety(beta, wetness(beta, sca, Q_MAX))
    lab, _ = ndimage.label(ndimage.binary_opening(fs_peak < 1, iterations=2))
    hr = int((Y1 - SRC_HINT[1]) / CELL); hc = int((SRC_HINT[0] - X0) / CELL)
    rr, cc = np.nonzero(lab > 0)
    k = np.argmin((rr - hr) ** 2 + (cc - hc) ** 2)
    source = lab == lab[rr[k], cc[k]]
    reach, weight, vel, tarr = runout(d, source)
    V = float(source.sum() * CELL * CELL * Z_SOIL)
    # deposit: volume spread over the runout cells outside the scar, weighted by
    # flow share and slowness (fast flow passes, slow flow deposits)
    out = reach & ~source
    vmax = float(vel[reach].max())
    dw = np.where(out, weight * (1.0 - vel / max(vmax, 1e-6)), 0.0)
    dw = ndimage.gaussian_filter(dw, 3.0) * out          # spread, no single-cell spikes
    dep = ndimage.gaussian_filter(dw / dw.sum() * V / (CELL * CELL), 2.5)   # soft edges
    dep *= V / (dep.sum() * CELL * CELL)                                        # volume conserved
    # runout length along the slide axis (source centroid -> deposit centroid):
    # crown = source cell furthest back on the axis, toe = runout cell furthest ahead
    rs_, cs_ = np.nonzero(source)
    rd_, cd_ = np.nonzero(dep > 0.05 * dep.max())
    ax = np.array([rd_.mean() - rs_.mean(), cd_.mean() - cs_.mean()])
    ax /= np.hypot(*ax)
    r2, c2 = np.nonzero(reach)
    ps, pr = rs_ * ax[0] + cs_ * ax[1], r2 * ax[0] + c2 * ax[1]
    crown, toe = np.argmin(ps), np.argmax(pr)
    L = float((pr[toe] - ps[crown]) * CELL)
    Hd = float(d[rs_[crown], cs_[crown]] - d[r2[toe], c2[toe]])
    res = {"area_m2": float(source.sum() * CELL * CELL), "volume_m3": V, "mass_t": V * GAMMA / G / 1000,
           "runout_m": L, "drop_m": Hd, "apparent_angle_deg": math.degrees(math.atan(Hd / L)),
           "corominas_angle_deg": math.degrees(math.atan(0.97 * V ** -0.105)),
           "v_max_ms": vmax, "travel_s": float(np.nanmax(np.where(reach, tarr, np.nan))),
           "deposit_max_m": float(dep.max()),
           "params": {"c_kPa": C_EFF / 1e3, "phi_deg": math.degrees(PHI), "gamma_kN": GAMMA / 1e3,
                      "z_m": Z_SOIL, "T_m2d": T_SOIL, "q_max_mmd": Q_MAX * 1000, "mu": MU, "xi": XI,
                      "cell_m": CELL, "vis": VIS, "vis_dep": VIS_DEP}}
    (WORK / "landslide.json").write_text(json.dumps(res, indent=1))
    print(json.dumps(res, indent=1))
    return d, beta, sca, source, reach, weight, tarr, dep, res


def orthophoto(sl):
    """DOP10 orthophoto (Geobasis NRW) cut to the render window, as a W x H float RGB array."""
    import rasterio
    from rasterio.merge import merge
    x0 = X0 + sl[1].start * CELL; x1 = X0 + sl[1].stop * CELL
    y1 = Y1 - sl[0].start * CELL; y0 = Y1 - sl[0].stop * CELL
    srcs = [rasterio.open(f) for f in sorted(glob.glob(str(WORK / "dop10rgbi_32_*.jp2")))]
    a, _ = merge(srcs, bounds=(x0, y0, x1, y1), indexes=[1, 2, 3], res=0.4)
    im = Image.fromarray(np.moveaxis(a, 0, -1)).resize((W, H), Image.LANCZOS)
    return np.asarray(im).astype(np.float32)


def render():
    d, beta, sca, source, reach, weight, tarr, dep, res = simulate()
    sl = window_slice()
    dw, bw, aw = d[sl], beta[sl], sca[sl]
    srcw, rw, ww, tw, depw = source[sl], reach[sl], weight[sl], tarr[sl], dep[sl]
    t_end = res["travel_s"]
    # particles (window grid coordinates) for the 3D page
    paths = trajectories(d, source)
    r_off, c_off = sl[0].start, sl[1].start
    flat, offs = [], [0]
    for pth in paths:
        for r, c, tt in pth:
            flat += [r - r_off, c - c_off, tt]
        offs.append(len(flat) // 3)
    (WORK / "ls_part.bin").write_bytes(np.array(flat, np.float32).tobytes())
    (WORK / "ls_part_off.bin").write_bytes(np.array(offs, np.int32).tobytes())
    # flow duration: 95 % of the debris particles have stopped (a few stragglers creep on)
    t_end = float(np.percentile([p[-1][2] for p in paths], 95))
    res["travel_s"] = t_end
    (WORK / "landslide.json").write_text(json.dumps(res, indent=1))
    # geometry for the 3D page: base heights, scar (-z), deposit (+), arrival time
    base = dw.astype(np.float32)
    zmin = float(base.min())
    (WORK / "ls_dem.bin").write_bytes((base - zmin).tobytes())
    scar = -Z_SOIL * ndimage.gaussian_filter(srcw.astype(float), 0.8)          # rounded scarp
    (WORK / "ls_scar.bin").write_bytes(scar.astype(np.float32).tobytes())
    (WORK / "ls_dep.bin").write_bytes(depw.astype(np.float32).tobytes())
    (WORK / "ls_arr.bin").write_bytes(np.where(rw, tw, 1e9).astype(np.float32).tobytes())
    n_frames = FPS * SECONDS
    timeline = []
    tex, pan = WORK / "landslide_tex", WORK / "landslide_panel"
    for p in (tex, pan):
        shutil.rmtree(p, ignore_errors=True); p.mkdir(parents=True)
    up = lambda a: np.asarray(Image.fromarray(np.asarray(a, np.float32)).resize((W, H), Image.BILINEAR))
    ortho = orthophoto(sl)                    # real DOP10 colours as the ground texture
    mono = lambda s: ImageFont.truetype(MONO, s)
    f_small, f_mid, f_big = mono(17), mono(20), mono(26)
    src_up = up(srcw) > 0.5
    arr_up = up(np.where(rw, tw, 1e4))
    wgt_up = up(np.log1p(ww * 50) * rw)
    wmax = float(np.percentile(wgt_up[wgt_up > 0], 99))
    for i in range(n_frames):
        t = i / FPS
        q = Q_MAX * smooth((t - T_RAIN[0]) / (T_RAIN[1] - T_RAIN[0]))
        fail = smooth((t - T_FAIL) / 0.7)
        sim_t = t_end * min(max((t - T_FLOW) / (T_FLOW_END - T_FLOW), 0.0), 1.0)   # simulated time, linear
        timeline.append({"fail": fail, "sim_t": sim_t, "rain": q / Q_MAX, "t": t})
        m = wetness(bw, aw, q)
        fs = factor_of_safety(bw, m)
        # hillshade of the current surface (scar and deposit change the shading)
        grow = np.clip((sim_t - np.where(np.isfinite(tw), tw, 1e9)) / RAMP_S, 0, 1)
        surf = dw + VIS * fail * scar + VIS_DEP * depw * grow
        hs = up(hillshade(surf))
        # the 3D page lights the terrain itself; the orthophoto already carries its own shading
        img = ortho * (0.8 + 0.25 * hs[..., None])
        # soil water: darker and bluer where saturated (hollows first); dries out after the event
        mu = up(m)[..., None] * (1 - 0.7 * fail)
        img = img * (1 - 0.32 * mu ** 2) + np.array([40, 95, 160]) * 0.32 * mu ** 2
        fsu = up(fs)
        clear = smooth((t - T_FAIL - 0.8) / 2.5)          # after the slide: back to the plain landscape
        warn = (np.clip((1.5 - fsu) / 0.5, 0, 1) * (fsu >= 1))[..., None] * (1 - 0.6 * fail) * (1 - clear)
        img = img * (1 - 0.55 * warn) + np.array([235, 160, 40]) * 0.55 * warn
        bad = (fsu < 1)[..., None] * (0.7 - 0.4 * fail) * (1 - clear)
        img = img * (1 - bad) + np.array([200, 40, 30]) * bad
        if fail > 0:   # exposed ground in the scar, keeps the new shading
            s = src_up[..., None] * fail
            img = img * (1 - 0.92 * s) + (np.array(SCAR) * (0.55 + 0.6 * hs[..., None])) * 0.92 * s
        if sim_t > 0:  # debris where it has arrived
            on = (arr_up <= sim_t) & (wgt_up > 0) & ~src_up
            inten = np.clip(wgt_up / wmax, 0.3, 1)[..., None] * on[..., None]
            img = img * (1 - 0.8 * inten) + (np.array([150, 92, 52]) * (0.6 + 0.5 * hs[..., None])) * 0.8 * inten
        Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(tex / f"{i:04d}.jpg", quality=92)

        # panel layer (symbols and SI units: reads in both languages)
        im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        dr = ImageDraw.Draw(im)
        dr.rectangle((24, 24, 660, 250 if t < T_FAIL else 404), fill=(14, 18, 21, 205))
        dr.text((44, 40), "FS = [c′ + (γ − m·γw) z cos²β tanφ′] / (γ z sinβ cosβ)",
                font=f_small, fill=(228, 230, 231))
        dr.text((44, 66), "m = min(1, q·a / (T·sinβ))", font=f_small, fill=(228, 230, 231))
        dr.text((44, 94), f"c′ {C_EFF / 1e3:.0f} kPa  φ′ {math.degrees(PHI):.0f}°  z {Z_SOIL:g} m  T {T_SOIL:.0f} m²/d",
                font=f_small, fill=(141, 151, 158))
        dr.text((44, 128), "q", font=f_mid, fill=(228, 230, 231))
        dr.rectangle((84, 132, 404, 148), outline=(141, 151, 158))
        dr.rectangle((84, 132, 84 + 320 * q / Q_MAX, 148), fill=(70, 130, 180))
        dr.text((420, 126), f"{q * 1000:3.0f} mm/d", font=f_mid, fill=(228, 230, 231))
        dr.rectangle((44, 172, 62, 190), fill=(200, 40, 30)); dr.text((74, 170), "FS < 1", font=f_small, fill=(228, 230, 231))
        dr.rectangle((210, 172, 228, 190), fill=(235, 160, 40)); dr.text((240, 170), "FS 1 … 1.5", font=f_small, fill=(228, 230, 231))
        dr.text((44, 208), f"FS < 1: {fmt((fs < 1).sum() * CELL * CELL)} m²", font=f_mid, fill=(228, 230, 231))
        if t >= T_FAIL:
            a = int(255 * smooth((t - T_FAIL) / 0.6))
            dr.text((44, 252), f"V ≈ {fmt(round(res['volume_m3'], -2))} m³   M ≈ {fmt(round(res['mass_t'], -2))} t",
                    font=f_big, fill=(255, 106, 43, a))
            dr.text((44, 292), f"v₂² = v₁² + 2g(Δz − μΔs) − 2gΔs v₁²/ξ   μ {MU:g}  ξ {XI:.0f}",
                    font=f_small, fill=(228, 230, 231, a))
            if sim_t > 0:
                b = int(255 * smooth((t - T_FLOW) / 0.5))
                k = sim_t / t_end
                dr.text((44, 324), f"t = {sim_t:4.0f} s", font=f_big, fill=(228, 230, 231, b))
                dr.text((44, 360), f"v max ≈ {res['v_max_ms']:.0f} m/s   L ≈ {fmt(round(res['runout_m'] * k, -1))} m",
                        font=f_big, fill=(228, 230, 231, b))
        im.save(pan / f"{i:04d}.png")
        if i % 60 == 0:
            print("frame", i)
    (WORK / "ls_dem.json").write_text(json.dumps({"rows": dw.shape[0], "cols": dw.shape[1], "cell": CELL,
                                                    "frames": n_frames, "vis": VIS, "vis_dep": VIS_DEP, "ramp": RAMP_S,
                                                    "particles": len(paths),
                                                    "timeline": timeline}))


def compose3d():
    """Panel layer over the 3D frames (render_landslide3d.mjs), then encode."""
    src, pan = WORK / "landslide_3d", WORK / "landslide_panel"
    out = WORK / "landslide_final"
    shutil.rmtree(out, ignore_errors=True); out.mkdir()
    files = sorted(src.glob("*.png"))
    for f in files:
        im = Image.alpha_composite(Image.open(f).convert("RGBA"), Image.open(pan / f.name).convert("RGBA"))
        im.convert("RGB").save(out / f.name)
    pat = str(out / "%04d.png")
    run = lambda *a: subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *a], check=True)
    # rain streaks are expensive for a codec: fixed bitrate (two-pass VP9), ~5 MB
    vp9 = ["-framerate", str(FPS), "-i", pat, "-pix_fmt", "yuv420p", "-c:v", "libvpx-vp9", "-b:v", "2400k", "-row-mt", "1", "-an"]
    run(*vp9, "-pass", "1", "-passlogfile", str(WORK / "ls2pass"), "-f", "null", "/dev/null")
    run(*vp9, "-pass", "2", "-passlogfile", str(WORK / "ls2pass"), str(OUT / "landslide-sim.webm"))
    run("-framerate", str(FPS), "-i", pat, "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:v", "libx264",
        "-preset", "slow", "-b:v", "2800k", "-maxrate", "3500k", "-bufsize", "6000k", "-an", str(OUT / "landslide-sim.mp4"))
    Image.open(files[-1]).convert("RGB").resize((720, 405), Image.LANCZOS).save(
        OUT / "landslide-sim-720.webp", quality=80, method=6)
    print("done")


if __name__ == "__main__":
    if "--scan" in sys.argv:
        scan()
    elif "--compose3d" in sys.argv:
        compose3d()
    else:
        render()

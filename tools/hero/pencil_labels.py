#!/usr/bin/env python3
"""Place names pencilled onto the hero sheet (goes with the paper look).

    python3 tools/hero/pencil_labels.py index.html de/index.html   # needs fontTools, pyproj

Writes an SVG (same 10 x 5 km frame as the hero map, viewBox in metres) between
the <!-- build:hero-pencil --> markers, right after the hero map, with the place
names, the hero sentence (from the page's <h1>, which stays as visually hidden
text) and the pencilled notes (text in the page's <html lang>). Positions are
OpenStreetMap place nodes (fetched 2026-10-10); names are proper nouns, the same
in both languages. The handwriting is Reenie Beanie (SIL OFL, tools/hero/fonts/),
converted to outlines here, so no font is loaded on the site: each glyph is a
<path> in <defs>, reused with <use>. Colour (--pencil) and the graphite grain
(a static noise mask; a live SVG filter here made the hero's scroll stutter) live in CSS.
"""
import json
import math
import random
import re
import struct
import sys
from html import unescape
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from pyproj import Transformer

FONT = Path(__file__).with_name("fonts") / "ReenieBeanie.ttf"
X0, Y1 = 408660, 5319200          # hero bbox west / north (UTM 32N), see hero-contours.json
# name, lat, lon (OSM place node), size in m (em; the hero sentence uses the same, 0.013 x --mw), side, class
PLACES = [
    ("Freiburg", 47.99609, 7.84940, 130, "l", "pc-city"),
    ("Rieselfeld", 47.99947, 7.79143, 130, "r", "pc-wide"),
    ("Lehen", 48.01677, 7.80227, 130, "r", "pc-wide"),
    ("Waldsee", 47.98813, 7.88440, 130, "r", "pc-wide"),
]
# pencilled notes (owner's jokes, 2026-10-10): text per page language, start of the baseline in map metres
# (from the top left), tilt, the arrow's target, class, where the arrow starts ("end" of the line or "below"
# its middle; owner: the kite arrow from below the middle). Hiking: the 663 m summit north-east of Freiburg, a DEM
# maximum that stays on screen on wide displays (the two higher ones sit right at the cropped east edge).
# Kite: the Lorettoberg (OSM peak, 385 m, 47.97492 N 7.83959 E) lies 36 m south of the sheet, so the arrow
# runs off the bottom edge at its longitude, as old maps point to places beyond the edge.
# the hero sentence itself, drawn like the place names so it looks exactly the same (owner, 2026-10-10); the
# real <h1> stays in the page, visually hidden. Text from the page's <h1>; start of the first baseline, line
# step, wrap width (map metres), tilt, class. Centred just above Freiburg; phones crop the map to x ~3660-6340,
# so they get their own copy inside that window.
SAY = [
    (4320, 2390, 150, 2200, -1.2, "pc-wide"),
    (3800, 2390, 150, 2400, -1.2, "pc-narrow"),
]
NOTES = [
    ({"en": "this is where I go hiking", "de": "hier gehe ich wandern"}, 5750, 1330, -2.5, (8975, 1675), "pc-wide",
     "end"),
    ({"en": "this is where I fly my kite", "de": "hier lasse ich meinen Drachen steigen"}, 3150, 3900, -2,
     (4737, 4990), "pc-wide", "below"),                  # arrowhead just inside the bottom edge
]

# The main border fault of the Upper Rhine Graben (owner's geology background, 2026-10-14), pencilled on as in a
# geological mapping exercise: freehand line with ticks on the downthrown side (the Rhine plain, west), a gap
# wherever it meets pencil text, and a two-line note beside it (start of the first baseline, line step, tilt).
# Line: LGRB GÜK300 (tools/hero/build_faults.py).
FAULTS = Path(__file__).resolve().parents[2] / "assets" / "topo" / "hero-faults.json"
FAULT_NOTE = ({"en": ["Rhine Graben fault:", "the plain sank, the Black Forest rose"],
               "de": ["Rheingraben-Störung:", "die Ebene sank, der Schwarzwald hob sich"]}, 6720, 1790, 150, -2)

# Contour-reading exercises, as a geology student pencils them onto a sheet (2026-10-14): a slope worked out
# between A and B (straight uphill on the Black Forest edge; numbers from the DEM) and a spot height on the hiking
# summit (the DEM maximum).
DEM = Path(__file__).resolve().parents[2] / "assets" / "topo" / "hero-contours-dem.bin"   # 200 x 100, 50 m
SLOPE = ((7950, 3000), (7702, 2454), (8090, 2800), -2)   # A, B, start of the working, its tilt
SPOT = (8975, 1675)
# Rule of V's (2026-10-14): one contour's V traced over in pencil, in the valley between the fault note and B, where
# the contours make the sharpest V's on the sheet (38-59 degrees; the DEM rises beyond each apex, so they are
# valleys, not spurs), and a note just below the tip: apex (on the drawn contour), arm length along the contour,
# note (start of the first baseline, line step, tilt).
CONTOURS = Path(__file__).resolve().parents[2] / "assets" / "topo" / "hero-contours.svg"
VEE = ((7219, 2472), 300, {"en": ["rule of V's:", "the V points upstream"],
                           "de": ["V-Regel:", "das V zeigt talaufwärts"]}, 6650, 2700, 150, -2)

font = TTFont(FONT)
gs, cmap, hmtx = font.getGlyphSet(), font.getBestCmap(), font["hmtx"]
UPM = font["head"].unitsPerEm
to_utm = Transformer.from_crs(4326, 32632, always_xy=True)


def contour_lines():
    """The hero's drawn contours (hero-contours.svg) as polylines in map metres."""
    lines = []
    for d in re.findall(r'<path d="([^"]+)"', CONTOURS.read_text()):
        x = y = 0
        for cmd, args in re.findall(r"([mMlLhHvV])([^mMlLhHvV]*)", d):
            v = [float(t) for t in re.findall(r"-?\d*\.?\d+", args)]
            rel = cmd.islower()
            if cmd in "mM":
                x, y = (x + v[0], y + v[1]) if rel else (v[0], v[1])
                lines.append([(x, y)])
                v, cmd = v[2:], "l" if rel else "L"
            if cmd in "lL":
                for i in range(0, len(v), 2):
                    x, y = (x + v[i], y + v[i + 1]) if rel else (v[i], v[i + 1])
                    lines[-1].append((x, y))
            elif cmd in "hH":
                for t in v:
                    x = x + t if rel else t
                    lines[-1].append((x, y))
            elif cmd in "vV":
                for t in v:
                    y = y + t if rel else t
                    lines[-1].append((x, y))
    return lines


def glyph_path(name):
    pen = SVGPathPen(gs, ntos=lambda v: str(round(v)))
    gs[name].draw(TransformPen(pen, (0.1, 0, 0, -0.1, 0, 0)))   # 1/100 em, font y up -> svg y down
    return pen.getCommands()


def build(lang, say):
    rnd = random.Random(7)                                 # same hand-drawn wobble on every page
    used = {}

    def ring(cx, cy, r):
        """A quick pencil circle: not round, not closed, a little overshoot."""
        a0 = rnd.uniform(0, 2 * math.pi)
        pts = []
        for i in range(23):
            a = a0 + i / 20 * 2 * math.pi
            rr = r * (1 + 0.12 * math.sin(3 * a + a0) + rnd.uniform(-0.04, 0.04))
            pts.append(f"{cx + rr * math.cos(a):.0f} {cy + rr * math.sin(a) * 0.9:.0f}")
        return "M" + " L".join(pts)

    boxes = []                                             # text boxes (map m), the fault leaves a gap there

    def words(text, tx, ty, rot, s):
        """<g> with the text as reused glyphs; returns it and the text width in map metres."""
        uses, pen_x = [], 0
        for ch in text:
            g = cmap[ord(ch)]
            gid = used.setdefault(g, f"pc{len(used)}")
            uses.append(f'<use href="#{gid}" x="{pen_x / 10:.0f}"/>')
            pen_x += hmtx[g][0]
        wd, a, em = pen_x * s, math.radians(rot), s * UPM
        cs = [(tx + u * math.cos(a) - v * math.sin(a), ty + u * math.sin(a) + v * math.cos(a))
              for u in (0, wd) for v in (-0.85 * em, 0.3 * em)]
        boxes.append((min(c[0] for c in cs) - 50, min(c[1] for c in cs) - 50, max(c[0] for c in cs) + 50,
                      max(c[1] for c in cs) + 50))
        return (f'<g transform="translate({tx:.0f} {ty:.0f}) rotate({rot:.1f}) scale({s * 10:.4f})">'
                f'{"".join(uses)}</g>'), pen_x * s

    labels = []
    for name, lat, lon, size, side, cls in PLACES:
        e, n = to_utm.transform(lon, lat)
        x, y = e - X0, Y1 - n
        s = size / UPM
        width = sum(hmtx[cmap[ord(ch)]][0] for ch in name) * s
        gap = size * 0.5
        tx = x + gap if side == "r" else x - gap - width
        ty = y + size * 0.22                               # baseline: x-height centred on the mark
        rot = rnd.uniform(-4, 3)
        r = size * (0.3 if cls == "pc-city" else 0.24)
        g, _ = words(name, tx, ty, rot, s)
        labels.append(
            f'<g class="{("pc " + cls).strip()}">'
            f'<path class="pc-line" d="{ring(x, y, r)}"/><circle cx="{x:.0f}" cy="{y:.0f}" r="{size * 0.06:.0f}"/>'
            f"{g}</g>"
        )
    size = PLACES[0][3]
    space = hmtx[cmap[ord(" ")]][0] * size / UPM
    for sx0, sy0, step, wrap, srot, scls in SAY:
        lines, line, lw = [], [], 0
        for word in say.split():
            w = sum(hmtx[cmap[ord(ch)]][0] for ch in word) * size / UPM
            if line and lw + space + w > wrap:
                lines.append(" ".join(line)); line, lw = [], 0
            line.append(word); lw += (space if lw else 0) + w
        lines.append(" ".join(line))
        a = math.radians(srot)                             # lines step down along the tilted text
        say_g = "".join(words(ln, sx0 - i * step * math.sin(a), sy0 + i * step * math.cos(a), srot, size / UPM)[0]
                        for i, ln in enumerate(lines))
        labels.append(f'<g class="pc pc-say {scls}">{say_g}</g>')
    for text, tx, ty, rot, (ex, ey), cls, start in NOTES:
        g, width = words(text[lang], tx, ty, rot, size / UPM)
        a = math.radians(rot)                              # the (tilted) line's direction
        if start == "end":                                 # from just after the last word
            sx, sy = tx + (width + size * 0.4) * math.cos(a), ty + (width + size * 0.4) * math.sin(a) - size * 0.3
        else:                                              # from just below the middle of the line
            sx, sy = tx + width / 2 * math.cos(a), ty + width / 2 * math.sin(a) + size * 0.45
        d = math.hypot(ex - sx, ey - sy)
        ex, ey = ex - (ex - sx) / d * size * 0.6, ey - (ey - sy) / d * size * 0.6   # stop short of the target
        # "end": bulge out, then drop onto the target; "below": drop first, then swing over to it
        cx, cy = (ex - size * 0.3, sy) if start == "end" else (sx, sy + (ey - sy) * 0.75)
        # a quick freehand stroke: the curve sampled with a little sideways wobble
        pts, n = [], max(12, int(d / (size * 0.9)))
        for i in range(n + 1):
            u = i / n
            px = (1 - u) ** 2 * sx + 2 * (1 - u) * u * cx + u * u * ex
            py = (1 - u) ** 2 * sy + 2 * (1 - u) * u * cy + u * u * ey
            w = size * 0.05 * math.sin(u * math.pi) * rnd.uniform(-1, 1)
            pts.append(f"{px + w:.0f} {py - w:.0f}")
        hd = math.atan2(ey - cy, ex - cx)
        head = " ".join(f"M{ex + size * 0.6 * math.cos(hd + math.pi + k):.0f} {ey + size * 0.6 * math.sin(hd + math.pi + k):.0f} L{ex:.0f} {ey:.0f}"
                        for k in (-0.5, 0.42))
        labels.append(f'<g class="{("pc " + cls).strip()}">{g}'
                      f'<path class="pc-line pc-arrow" d="M{" L".join(pts)} {head}"/></g>')

    if FAULTS.exists():
        size = PLACES[0][3]
        fl = [l for l in json.loads(FAULTS.read_text())["lines"]
              if sum(math.dist(l[i], l[i + 1]) for i in range(len(l) - 1)) > 400]
        lines_, nx0, ny0, step_, nrot = FAULT_NOTE[0][lang], FAULT_NOTE[1], FAULT_NOTE[2], FAULT_NOTE[3], FAULT_NOTE[4]
        na = math.radians(nrot)
        note = "".join(words(t, nx0 - i * step_ * math.sin(na), ny0 + i * step_ * math.cos(na), nrot, size / UPM)[0]
                       for i, t in enumerate(lines_))
        inbox = lambda x, y: any(b[0] <= x <= b[2] and b[1] <= y <= b[3] for b in boxes)
        strokes, ticks = [], []
        for l in fl:
            pts = []                                       # densify every 40 m, with a slight freehand wobble
            for i in range(len(l) - 1):
                (x0, y0), (x1, y1) = l[i], l[i + 1]
                n = max(1, int(math.dist(l[i], l[i + 1]) / 40))
                pts += [(x0 + (x1 - x0) * k / n + rnd.uniform(-9, 9), y0 + (y1 - y0) * k / n + rnd.uniform(-9, 9))
                        for k in range(n)]
            pts.append(tuple(l[-1]))
            run, along, next_tick = [], 0, 160
            for i, (x, y) in enumerate(pts):
                if i:
                    along += math.dist(pts[i - 1], pts[i])
                if inbox(x, y) or not (-50 <= x <= 10050 and -50 <= y <= 5050):
                    if len(run) > 1:
                        strokes.append(run)
                    run = []
                    continue
                run.append((x, y))
                if along >= next_tick and 0 < i < len(pts) - 1:   # a tick on the downthrown (west) side
                    next_tick += 330
                    tx_, ty_ = pts[i + 1][0] - pts[i - 1][0], pts[i + 1][1] - pts[i - 1][1]
                    tl = math.hypot(tx_, ty_) or 1
                    px, py = -ty_ / tl, tx_ / tl
                    if px > 0:
                        px, py = -px, -py
                    if not inbox(x + px * 75, y + py * 75):
                        ticks.append(f"M{x:.0f} {y:.0f} L{x + px * 75:.0f} {y + py * 75:.0f}")
            if len(run) > 1:
                strokes.append(run)
        d = " ".join("M" + " L".join(f"{x:.0f} {y:.0f}" for x, y in r) for r in strokes)
        labels.append(f'<g class="pc pc-wide"><path class="pc-line pc-fault" d="{d}"/>'
                      f'<path class="pc-line pc-tick" d="{" ".join(ticks)}"/>{note}</g>')

    if DEM.exists():
        size = PLACES[0][3]
        z = struct.unpack(f"<{DEM.stat().st_size // 2}h", DEM.read_bytes())

        def elev(x, y):                                    # bilinear between the 50 m cell centres
            fx, fy = min(max(x / 50 - 0.5, 0), 198.999), min(max(y / 50 - 0.5, 0), 98.999)
            i, j = int(fx), int(fy)
            u, v, k = fx - i, fy - j, int(fy) * 200 + int(fx)
            return (z[k] * (1 - u) + z[k + 1] * u) * (1 - v) + (z[k + 200] * (1 - u) + z[k + 201] * u) * v

        def stroke(pts):                                   # a freehand pencil line
            out = []
            for i in range(len(pts) - 1):
                (x0, y0), (x1, y1) = pts[i], pts[i + 1]
                n = max(1, int(math.dist(pts[i], pts[i + 1]) / 40))
                out += [(x0 + (x1 - x0) * k / n + rnd.uniform(-7, 7), y0 + (y1 - y0) * k / n + rnd.uniform(-7, 7))
                        for k in range(n)]
            out.append(pts[-1])
            return "M" + " L".join(f"{x:.0f} {y:.0f}" for x, y in out)

        # the slope, A (low) to B (high), the working from the rounded readings so the sum adds up
        (ax, ay), (bx, by), (wx, wy), wrot = SLOPE
        dh = round((elev(bx, by) - elev(ax, ay)) / 10) * 10
        run = round(math.dist((ax, ay), (bx, by)) / 10) * 10
        deg = round(math.degrees(math.atan(dh / run)))
        ux, uy = (bx - ax) / math.dist((ax, ay), (bx, by)), (by - ay) / math.dist((ax, ay), (bx, by))
        ends = " ".join(stroke([(x - uy * 55, y + ux * 55), (x + uy * 55, y - ux * 55)]) for x, y in ((ax, ay), (bx, by)))
        la, _ = words("A", ax - ux * 140 - 40, ay - uy * 140 + 40, 0, size / UPM)
        lb, _ = words("B", bx + ux * 90 - 30, by + uy * 90, 0, size / UPM)
        wk, _ = words(f"Δh {dh} m / {run} m ≈ {deg}°", wx, wy, wrot, size / UPM)
        labels.append(f'<g class="pc pc-wide"><path class="pc-line pc-fault" d="{stroke([(ax, ay), (bx, by)])} {ends}"/>'
                      f"{la}{lb}{wk}</g>")
        # the spot height (a pencilled cross and the reading)
        sx, sy = SPOT
        h = round(elev(sx, sy))
        cross = stroke([(sx - 45, sy - 45), (sx + 45, sy + 45)]) + " " + stroke([(sx - 45, sy + 45), (sx + 45, sy - 45)])
        sp, _ = words(str(h), sx + 90, sy + 150, -2, size * 0.9 / UPM)
        labels.append(f'<g class="pc pc-wide"><path class="pc-line" d="{cross}"/>{sp}</g>')
        # rule of V's: the contour through the apex, followed both ways along the line for the arm length
        (vx, vy), arm, vnote, vnx, vny, vstep, vrot = VEE
        line = min(contour_lines(), key=lambda l: min(math.dist(q, (vx, vy)) for q in l))
        k = min(range(len(line)), key=lambda i: math.dist(line[i], (vx, vy)))
        vee = [line[k]]
        for dirn in (-1, 1):
            i, along = k, 0
            while 0 <= i + dirn < len(line) and along < arm:
                along += math.dist(line[i], line[i + dirn])
                i += dirn
                vee.insert(0, line[i]) if dirn < 0 else vee.append(line[i])
        va = math.radians(vrot)
        vn = "".join(words(t, vnx - i * vstep * math.sin(va), vny + i * vstep * math.cos(va), vrot, size / UPM)[0]
                     for i, t in enumerate(vnote[lang]))
        labels.append(f'<g class="pc pc-wide"><path class="pc-line pc-fault" d="{stroke(vee)}"/>{vn}</g>')

    defs = "".join(f'<path id="{gid}" d="{glyph_path(g)}"/>' for g, gid in used.items())
    return (
        '<div class="pencil-box"><svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="pencil" '
        'viewBox="0 0 10000 5000" preserveAspectRatio="xMidYMid slice">'
        f"<defs>{defs}</defs>{''.join(labels)}</svg></div>"
    ), len(used)


for page in sys.argv[1:]:
    p = Path(page)
    html = p.read_text()
    if "<!-- build:hero-pencil -->" not in html:
        html = html.replace("<!-- /build:hero-map -->",
                            "<!-- /build:hero-map --><!-- build:hero-pencil --><!-- /build:hero-pencil -->", 1)
    say = unescape(re.sub(r"<[^>]+>", "", re.search(r'<h1 id="hero-title">(.*?)</h1>', html, re.S).group(1)))
    svg, n = build(re.search(r'<html lang="(\w+)"', html).group(1), say)
    html = re.sub(r"<!-- build:hero-pencil -->.*?<!-- /build:hero-pencil -->",
                  lambda m: f"<!-- build:hero-pencil -->{svg}<!-- /build:hero-pencil -->", html, flags=re.S)
    p.write_text(html)
    print(f"{page}: {len(svg) / 1024:.1f} KB of pencil labels ({n} glyphs)")

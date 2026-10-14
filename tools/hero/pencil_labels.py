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
import sys
from html import unescape
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).resolve().parent))
from doodle import STROKES, STUBBLE, smooth   # noqa: E402  (the owner's face, tools/hero/doodle.py)

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
    (180, 330, 150, 2200, -1.2, "pc-corner"),      # upper left (corner frame, see CORNER), the doodle below it
    (3800, 2390, 150, 2400, -1.2, "pc-narrow"),
]
NOTES = []   # the hiking and kite jokes were removed (owner, 2026-10-14: hero too busy)

# The main border fault of the Upper Rhine Graben (owner's geology background, 2026-10-14), pencilled on as in a
# geological mapping exercise: drawn with a ruler (straight segments along the mapped trace, simplified to
# RULER_TOL m), ticks on the downthrown side (the Rhine plain, west), presumed faults dashed, a gap wherever a
# line meets pencil text, a two-line note beside it (start of the first baseline, line step, tilt), and U / D on
# the upthrown / downthrown side. Lines: LGRB GÜK300 (tools/hero/build_faults.py).
FAULTS = Path(__file__).resolve().parents[2] / "assets" / "topo" / "hero-faults.json"
FAULT_NOTE = ({"en": ["Rhine Graben fault:", "the plain sank, the Black Forest rose"],
               "de": ["Rheingraben-Störung:", "die Ebene sank, der Schwarzwald hob sich"]}, 6720, 1790, 150, -2)
RULER_TOL = 90    # a ruler laid along the mapped trace in short pieces (300 m read as too straight, owner)
WOBBLE = 3        # m: the pencil does not follow the ruler perfectly
# the owner's face as a pencil doodle under the sentence: top left of the photo frame (map m), metres per
# photo pixel (the photo is 1280 px square), tilt
DOODLE = (300, 560, 0.68, -2)
# the sentence and the doodle live in their own small SVG pinned to the hero's top left corner (owner,
# 2026-10-14), so they stay on screen however the map is cropped; same scale as the map (viewBox in map metres)
CORNER = (2600, 1600)
UD = (2050, 170)          # U / D beside the main fault at this y (map m), this far either side of it
# Rock units from the same map (LGRB GÜK300 units, layer ms:gu300af_m; each point checked to lie inside the unit):
# text per language, start of the baseline, tilt. Würm gravels on the Rhine plain, paragneiss in the Black Forest.
UNITS = [({"en": "Würm gravels", "de": "Würm-Schotter"}, 2650, 1360, -1),
         ({"en": "paragneiss", "de": "Paragneis"}, 7480, 960, -1),
         # the foothill blocks caught at the graben's edge, outlined from the same map (hero-units.json)
         ({"en": "Middle Jurassic", "de": "Mitteljura"}, 5290, 520, -1),
         ({"en": "Triassic sandstone", "de": "Buntsandstein"}, 3060, 4470, -1)]
UNIT_OUTLINES = Path(__file__).resolve().parents[2] / "assets" / "topo" / "hero-units.json"
# reading the contour spacing (owner, 2026-10-14): text per language, start of the baseline, tilt
READ = [({"en": "lines close: steep", "de": "Linien eng: steil"}, 7350, 4420, -3),
        ({"en": "lines far apart: flat", "de": "Linien weit: flach"}, 1100, 3550, 2)]


font = TTFont(FONT)
gs, cmap, hmtx = font.getGlyphSet(), font.getBestCmap(), font["hmtx"]
UPM = font["head"].unitsPerEm
to_utm = Transformer.from_crs(4326, 32632, always_xy=True)


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
    corner = []                                        # the sentence + doodle, pinned top left
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
        (corner if scls == "pc-corner" else labels).append(f'<g class="pc pc-say {scls}">{say_g}</g>')
    ox, oy, ms, rot = DOODLE                              # the face, quick pencil strokes with a slight wobble
    ca, sa = math.cos(math.radians(rot)), math.sin(math.radians(rot))
    tr = lambda x, y: (ox + (x * ca - y * sa) * ms, oy + (x * sa + y * ca) * ms)
    strokes = []
    for pts in STROKES.values():
        jit = [(x + rnd.uniform(-5, 5), y + rnd.uniform(-5, 5)) for x, y in pts]   # a hand, not a zigzag:
        q = [tr(x, y) for x, y in smooth(jit)]                                      # shake the control points only
        strokes.append("M" + " L".join(f"{x:.0f} {y:.0f}" for x, y in q))
    for x, y, a in STUBBLE:
        r = math.radians(a)
        (x0, y0), (x1, y1) = tr(x, y), tr(x + 16 * math.cos(r), y + 16 * math.sin(r))
        strokes.append(f"M{x0:.0f} {y0:.0f} L{x1:.0f} {y1:.0f}")
    corner.append(f'<g class="pc pc-doodle"><path class="pc-line" d="{" ".join(strokes)}"/></g>')
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
        fl = json.loads(FAULTS.read_text())["lines"]
        lines_, nx0, ny0, step_, nrot = FAULT_NOTE[0][lang], FAULT_NOTE[1], FAULT_NOTE[2], FAULT_NOTE[3], FAULT_NOTE[4]
        na = math.radians(nrot)
        note = "".join(words(t, nx0 - i * step_ * math.sin(na), ny0 + i * step_ * math.cos(na), nrot, size / UPM)[0]
                       for i, t in enumerate(lines_))
        units = "".join(words(t[lang], x, y, r, size / UPM)[0] for t, x, y, r in UNITS)
        units += "".join(words(t[lang], x, y, r, size / UPM)[0] for t, x, y, r in READ)
        inbox = lambda x, y: any(b[0] <= x <= b[2] and b[1] <= y <= b[3] for b in boxes)

        def ruler(pts, tol=RULER_TOL):                     # Douglas-Peucker: the few straight strokes of a ruler
            if len(pts) < 3:
                return pts
            (ax, ay), (bx, by) = pts[0], pts[-1]
            L = math.hypot(bx - ax, by - ay) or 1
            d = [abs((bx - ax) * (ay - y) - (ax - x) * (by - ay)) / L for x, y in pts[1:-1]]
            k = max(range(len(d)), key=d.__getitem__)
            if d[k] < tol:
                return [pts[0], pts[-1]]
            return ruler(pts[:k + 2], tol)[:-1] + ruler(pts[k + 1:], tol)

        solid, dashed, ticks, main = [], [], [], []
        for f in fl:
            pts = ruler([tuple(p) for p in f["pts"]])
            out = solid if f["type"] == "proven" else dashed
            for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
                seg_len = math.dist((x0, y0), (x1, y1))
                ux, uy = (x1 - x0) / seg_len, (y1 - y0) / seg_len
                px, py = (-uy, ux) if -uy < 0 else (uy, -ux)   # unit normal pointing west (downthrown side)
                tickable = f["type"] == "proven" and abs(uy) > abs(ux)   # the N-S border fault, not cross faults
                if tickable:
                    main.append(((x0, y0), (x1, y1)))
                run, n = [], max(1, int(seg_len / 20))
                for k in range(n + 1):                     # straight, but broken where pencil text sits
                    x, y = x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n
                    if 0 < k < n:
                        x, y = x + rnd.uniform(-WOBBLE, WOBBLE), y + rnd.uniform(-WOBBLE, WOBBLE)
                    if inbox(x, y) or not (-50 <= x <= 10050 and -50 <= y <= 5050):
                        if len(run) > 1:
                            out.append(run)
                        run = []
                    else:
                        run.append((x, y))
                if len(run) > 1:
                    out.append(run)
                if tickable:
                    t = 165
                    while t < seg_len - 60:
                        x, y = x0 + ux * t, y0 + uy * t
                        if (-50 <= x <= 10050 and -50 <= y <= 5050 and not inbox(x, y)
                                and not inbox(x + px * 75, y + py * 75)):
                            ticks.append(f"M{x:.0f} {y:.0f} L{x + px * 75:.0f} {y + py * 75:.0f}")
                        t += 330
        ud = ""
        uy_ = UD[0]                                        # U (up) east and D (down) west of the main fault
        for (x0, y0), (x1, y1) in main:
            if min(y0, y1) <= uy_ <= max(y0, y1):
                x = x0 + (x1 - x0) * (uy_ - y0) / (y1 - y0)
                ud = (words("D", x - UD[1] - 60, uy_ + 40, 0, size / UPM)[0]
                      + words("U", x + UD[1] - 20, uy_ + 40, 0, size / UPM)[0])
                break
        path = lambda runs: " ".join("M" + " L".join(f"{x:.0f} {y:.0f}" for x, y in r) for r in runs)
        contacts = []                                      # unit outlines, freehand; not along the frame edge
        if UNIT_OUTLINES.exists():
            for u in json.loads(UNIT_OUTLINES.read_text())["units"]:
                run = []
                for (x0, y0), (x1, y1) in zip(u["pts"], u["pts"][1:]):
                    edge = (y0 <= 2 and y1 <= 2) or (y0 >= 4998 and y1 >= 4998)
                    if edge:
                        if len(run) > 1:
                            contacts.append(run)
                        run = []
                        continue
                    n = max(1, int(math.dist((x0, y0), (x1, y1)) / 30))
                    run += [(x0 + (x1 - x0) * k / n + rnd.uniform(-4, 4), y0 + (y1 - y0) * k / n + rnd.uniform(-4, 4))
                            for k in range(n)]
                if len(run) > 1:
                    contacts.append(run)
        labels.append(f'<g class="pc pc-wide"><path class="pc-line pc-fault" d="{path(solid)}"/>'
                      f'<path class="pc-line pc-fault pc-presumed" d="{path(dashed)}"/>'
                      f'<path class="pc-line pc-tick" d="{" ".join(ticks)}"/>'
                      f'<path class="pc-line pc-contact" d="{path(contacts)}"/>{note}{ud}{units}</g>')

    defs = "".join(f'<path id="{gid}" d="{glyph_path(g)}"/>' for g, gid in used.items())
    return (
        '<div class="pencil-box"><svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="pencil" '
        'viewBox="0 0 10000 5000" preserveAspectRatio="xMidYMid slice">'
        f"<defs>{defs}</defs>{''.join(labels)}</svg></div>"
        '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="pencil pencil-corner" '
        f'viewBox="0 0 {CORNER[0]} {CORNER[1]}">{"".join(corner)}</svg>'
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

"""Pencil doodle of the owner's face for the hero sheet (owner's idea, 2026-10-14).

Hand-placed strokes over the portrait me.jpg (1280 x 1280 px; backlit with a sun flare, so line extraction
does not work): head and short hair, ears, squinting eyes, nose, the big smile, a hint of stubble, collar.
STROKES are polylines in photo pixels, smoothed into curves by pencil_labels.py.

    python3 tools/hero/doodle.py --check     # draws the strokes over the photo -> /tmp/doodle-check.png
"""
STROKES = {
    # head: hair outline (crown and sides) and the hairline
    "hair": [(372, 420), (352, 300), (372, 190), (430, 110), (520, 55), (640, 30), (760, 45), (860, 95), (930, 170),
             (968, 260), (985, 370), (978, 470)],
    "hairline": [(400, 300), (430, 225), (520, 190), (640, 200), (760, 215), (860, 240), (930, 300), (960, 380)],
    # face outline: cheeks and jaw down to the chin
    "jaw_l": [(372, 420), (365, 520), (378, 640), (410, 760), (460, 870), (530, 960), (610, 1010), (680, 1020)],
    "jaw_r": [(978, 470), (970, 600), (950, 720), (915, 830), (860, 930), (790, 995), (680, 1020)],
    # ears
    "ear_l": [(370, 500), (320, 480), (300, 530), (315, 600), (350, 640), (378, 640)],
    "ear_r": [(975, 495), (1000, 505), (1005, 560), (985, 600), (965, 605)],
    # eyebrows and eyes (squinting into the sun)
    "brow_l": [(440, 400), (490, 382), (560, 385)],
    "brow_r": [(690, 392), (760, 378), (830, 385)],
    "eye_l": [(455, 478), (500, 466), (565, 478)],
    "eye_r": [(700, 472), (760, 460), (825, 470)],
    # nose
    "nose": [(625, 440), (612, 520), (595, 590), (590, 630), (620, 660), (680, 665), (720, 640)],
    # the smile: upper lip line, teeth, lower lip, laugh lines
    "mouth_top": [(515, 755), (580, 740), (660, 745), (740, 735), (805, 742)],
    "mouth_bot": [(530, 765), (580, 805), (650, 830), (720, 820), (790, 760)],
    "teeth": [(560, 768), (640, 780), (720, 772), (770, 760)],
    "laugh_l": [(470, 650), (480, 720), (505, 770)],
    "laugh_r": [(835, 640), (830, 705), (812, 750)],
    # neck and the jacket collar (soft folds of the hood)
    "neck_l": [(505, 985), (495, 1070), (480, 1140)],
    "neck_r": [(855, 935), (868, 1020), (885, 1090)],
    "collar_l": [(480, 1140), (420, 1090), (365, 1000), (320, 905), (230, 870), (140, 900)],
    "collar_r": [(885, 1090), (950, 1030), (1000, 940), (1040, 860), (1140, 840), (1230, 880)],
    # a few strokes for the cropped hair
    "hair1": [(470, 140), (520, 120)], "hair2": [(590, 95), (650, 85)], "hair3": [(720, 100), (780, 110)],
    "hair4": [(840, 150), (880, 180)], "hair5": [(420, 210), (445, 175)], "hair6": [(905, 230), (925, 265)],
}
# a quick caricature (owner, 2026-10-14: the traced face "feels kinda fake"): a few loose lines, the grin and the
# squint exaggerated, zigzag for the cropped hair; same photo-pixel frame as STROKES
CARICATURE = {
    "head": [(392, 360), (420, 190), (530, 85), (690, 60), (850, 110), (950, 240), (975, 420), (960, 600), (915, 780),
             (830, 925), (700, 995), (565, 975), (460, 880), (400, 720), (378, 540), (388, 400)],
    # cropped hair: a few quick slanted hatches inside the crown
    "hair1": [(445, 250), (480, 170)], "hair2": [(505, 225), (545, 135)], "hair3": [(575, 205), (615, 112)],
    "hair4": [(645, 195), (685, 100)], "hair5": [(715, 200), (755, 108)], "hair6": [(785, 215), (825, 125)],
    "hair7": [(850, 240), (885, 165)], "hairline": [(430, 280), (560, 245), (700, 240), (830, 255), (915, 300)],
    "ear_l": [(385, 520), (340, 500), (330, 570), (372, 615)],
    "ear_r": [(968, 520), (1005, 515), (1010, 575), (962, 610)],
    "brow_l": [(455, 405), (545, 395)], "brow_r": [(700, 398), (800, 388)],
    "eye_l": [(450, 488), (500, 455), (560, 485)],
    "eye_r": [(700, 480), (755, 448), (818, 478)],
    "nose": [(640, 470), (612, 600), (628, 640), (668, 642)],
    "grin_top": [(465, 690), (580, 725), (690, 735), (800, 715), (885, 670)],
    "grin_bot": [(468, 695), (540, 790), (650, 835), (770, 810), (880, 676)],
    "dimple_l": [(445, 665), (462, 700)], "dimple_r": [(905, 650), (885, 690)],
    "neck_l": [(565, 975), (555, 1085)], "neck_r": [(820, 945), (840, 1060)],
}
CARICATURE_STUBBLE = [(600, 900, 90), (660, 915, 90), (720, 900, 90), (560, 875, 80), (770, 880, 100)]

# stubble: short ticks on chin and jaw (photo pixels, angle in degrees)
STUBBLE = [(560, 880, 80), (600, 900, 85), (650, 915, 90), (700, 905, 95), (745, 885, 100), (520, 840, 70),
           (790, 850, 110), (600, 950, 85), (660, 965, 90), (720, 950, 95), (470, 800, 65), (840, 800, 115)]


def smooth(pts, steps=8):
    """Catmull-Rom through the points: the hand draws curves, not polylines."""
    if len(pts) < 3:
        return list(pts)
    P = [pts[0]] + list(pts) + [pts[-1]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(steps):
            t = k / steps
            out.append(tuple(0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t * t
                                    + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t ** 3) for j in (0, 1)))
    out.append(pts[-1])
    return out


if __name__ == "__main__":
    import math
    import sys
    from pathlib import Path
    from PIL import Image, ImageDraw
    if "--check" in sys.argv:
        im = Image.open(Path(__file__).resolve().parents[2] / "me.jpg").convert("RGB")
        bare = Image.new("RGB", (1280, 1280), (233, 234, 230))
        for img, col in ((im, (255, 40, 0)), (bare, (60, 64, 68))):
            d = ImageDraw.Draw(img)
            for pts in STROKES.values():
                d.line(smooth(pts), fill=col, width=5, joint="curve")
            for x, y, a in STUBBLE:
                r = math.radians(a); d.line([(x, y), (x + 14 * math.cos(r), y + 14 * math.sin(r))], fill=col, width=4)
        c = Image.new("RGB", (1300, 640), "white"); c.paste(im.resize((640, 640)), (0, 0)); c.paste(bare.resize((640, 640)), (660, 0))
        c.save("/tmp/doodle-check.png")

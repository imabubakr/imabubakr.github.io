"""Build the "Visualizations" plates: web images/videos plus the markup in both pages.

For each plate in PLATES (source files are the old gallery images in the repo root):
  stills      -> assets/plates/<id>-720.webp (grid) and <id>-1600.webp (viewer)
  animations  -> assets/plates/<id>.webm + .mp4 (viewer) and <id>-720.webp poster (grid)
Then replaces the content between <!-- build:plates --> and <!-- /build:plates -->
in index.html (English) and de/index.html (German).

Requires Pillow and ffmpeg. Run from the repo root:  python3 tools/plates/build_plates.py
Add --skip-media to only rewrite the markup (e.g. after editing a caption).
"""

import html
import re
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets/plates"

C3S = "contains modified Copernicus Climate Change Service information 2023"

# id, source, animation?, poster frame (0..1 through the animation),
# (short title, full caption) in English and German
PLATES = [
    ("storm-emir", "storm.gif", True, 0.5,
     ("Storm Emir", f"Storm Emir, November 2023: wind field over Europe. Data: ERA5; {C3S}."),
     ("Sturm Emir", f'Sturm Emir, November 2023: Windfeld über Europa. Daten: ERA5; <span lang="en">{C3S}</span>.')),
    ("aurora", "aurora_rotation.gif", True, 0.3,
     ("Auroras over the North Pole", "Auroras over the North Pole, visualized in Python from NOAA data."),
     ("Polarlichter über dem Nordpol", "Polarlichter über dem Nordpol, in Python aus NOAA-Daten visualisiert.")),
    ("aral-sea", "aral.gif", True, 0.0,
     ("Aral Sea time-lapse", "Aral Sea time-lapse, starting in 1985."),
     ("Aralsee im Zeitraffer", "Zeitraffer des Aralsees ab 1985.")),
    ("lidar-dem", "lidar.gif", True, 0.6,
     ("From LiDAR to DSM and DEM", "From LiDAR to DSM and DEM: unveiling the hidden terrain."),
     ("Vom LiDAR zu DOM und DGM", "Vom LiDAR zu DOM und DGM: das verborgene Gelände sichtbar gemacht.")),
    ("europe-ridges", "europe-ridge-lines.png", False, 0,
     ("Ridge lines of Europe", "Ridge lines showing the topography of Europe."),
     ("Ridgelines Europas", "Ridgeline-Darstellung der Topografie Europas.")),
    ("air-temperature", "europe.png", False, 0,
     ("Surface air temperature change", "Change in surface air temperature between 1980 and 2018."),
     ("Änderung der Lufttemperatur", "Veränderung der bodennahen Lufttemperatur zwischen 1980 und 2018.")),
    ("freiburg-lst", "temp2.png", False, 0,
     ("Land surface temperature, Freiburg", "Average monthly land surface temperature in Freiburg, 2001–2023, analyzed in Google Earth Engine."),
     ("Landoberflächen&shy;temperatur, Freiburg", "Mittlere monatliche Landoberflächentemperatur in Freiburg, 2001–2023, ausgewertet in Google Earth Engine.")),
    ("landslide", "prog1.jpg", False, 0,
     ("Landslide simulation", "Simulated path of a landslide over real-world topography."),
     ("Erdrutsch-Simulation", "Simulierter Verlauf eines Erdrutschs über realer Topografie.")),
    ("freiburg-streets", "osm8.png", False, 0,
     ("Street network of Freiburg", "Street network of Freiburg im Breisgau."),
     ("Straßennetz von Freiburg", "Straßennetz von Freiburg im Breisgau.")),
]

LABELS = {
    "en": {"plate": "Plate", "anim": "animation", "open": "Open"},
    "de": {"plate": "Tafel", "anim": "Animation", "open": "Öffnen"},
}


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def save_webp(im, path, width, quality):
    im = im.convert("RGB")
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(path, quality=quality, method=6)
    return im.size


def build_media():
    OUT.mkdir(parents=True, exist_ok=True)
    sizes = {}
    for pid, src, anim, frame, *_ in PLATES:
        im = Image.open(ROOT / src)
        if anim:
            n = getattr(im, "n_frames", 1)
            im.seek(min(int(frame * n), n - 1))
            # The GIFs are dithered; a light denoise keeps the videos small.
            vf = "hqdn3d=3:3:4:4,scale=trunc(iw/2)*2:trunc(ih/2)*2"
            ffmpeg("-i", str(ROOT / src), "-an", "-pix_fmt", "yuv420p", "-vf", vf,
                   "-c:v", "libvpx-vp9", "-crf", "40", "-b:v", "0", "-row-mt", "1", str(OUT / f"{pid}.webm"))
            ffmpeg("-i", str(ROOT / src), "-an", "-pix_fmt", "yuv420p", "-vf", vf, "-movflags", "+faststart",
                   "-c:v", "libx264", "-preset", "veryslow", "-crf", "28", str(OUT / f"{pid}.mp4"))
            full = im.size
        else:
            full = save_webp(im, OUT / f"{pid}-1600.webp", 1600, 80)
        thumb = save_webp(im, OUT / f"{pid}-720.webp", 720, 72)
        sizes[pid] = (thumb, full)
        print(f"{pid:18} thumb {thumb[0]}x{thumb[1]}  full {full[0]}x{full[1]}")
    return sizes


def markup(lang, prefix):
    L = LABELS[lang]
    items = []
    for i, (pid, src, anim, frame, en, de) in enumerate(PLATES, 1):
        short, caption = en if lang == "en" else de
        base = f"{prefix}assets/plates/{pid}"
        full = f"{base}.mp4" if anim else f"{base}-1600.webp"
        thumb = Image.open(OUT / f"{pid}-720.webp").size
        data = f' data-webm="{base}.webm" data-mp4="{base}.mp4"' if anim else f' data-full="{base}-1600.webp"'
        tag = f'<span class="plate-tag">{L["anim"]}</span>' if anim else ""
        items.append(
            f'              <li class="plate">\n'
            f'                <a href="{full}" class="plate-link"{data} data-caption="{html.escape(caption, quote=True)}">\n'
            f'                  <img src="{base}-720.webp" width="{thumb[0]}" height="{thumb[1]}" loading="lazy" decoding="async" alt="">\n'
            f'                  <span class="plate-meta"><span class="plate-no">{L["plate"]} {i:02d}</span>{tag}</span>\n'
            f'                  <span class="plate-title">{short}</span>\n'
            f"                </a>\n"
            f"              </li>"
        )
    return '\n            <ol class="plates">\n' + "\n".join(items) + "\n            </ol>\n            "


def main():
    if "--skip-media" not in sys.argv:
        build_media()
    for path, lang, prefix in [("index.html", "en", ""), ("de/index.html", "de", "../")]:
        page = ROOT / path
        s = page.read_text()
        s, n = re.subn(r"(<!-- build:plates -->).*?(<!-- /build:plates -->)",
                       lambda m: m.group(1) + markup(lang, prefix) + m.group(2), s, flags=re.S)
        if not n:
            sys.exit(f"no build:plates marker in {path}")
        page.write_text(s)
        print(f"updated {path}")


if __name__ == "__main__":
    main()

"""Build the "Visualizations" plate index and the CV's certificate grid.

For each item in PLATES and CERTS (source files are images in the repo root):
  stills      -> assets/plates/<id>-720.webp (grid) and <id>-1600.webp (viewer)
  animations  -> assets/plates/<id>.webm + .mp4 (viewer) and <id>-720.webp poster (grid)
Then replaces the content between <!-- build:plates --> / <!-- build:certs --> and the
matching <!-- /build:... --> marker in index.html (English) and de/index.html (German).

Requires Pillow and ffmpeg. Run from the repo root:  python3 tools/plates/build_plates.py
Add --skip-media to only rewrite the markup (e.g. after editing a caption).
"""

import html
import re
import subprocess
import sys
from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = None  # freiburg4.png is a 125-megapixel poster

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets/plates"

C3S = "contains modified Copernicus Climate Change Service information 2023"

# id, source, animation?, poster frame (0..1 through the animation),
# (short title, full caption) in English and German
PLATES = [
    ("storm-emir", "storm.gif", True, 0.5,
     ("Storm Emir", f"Storm Emir, November 2023: wind field over Europe. Data: ERA5; {C3S}."),
     ("Sturm Emir", f'Sturm Emir, November 2023: Windfeld über Europa. Daten: ERA5; <span lang="en">{C3S}</span>.')),
    ("wind-europe", "europe9.png", False, 0,
     ("Wind over Europe", "Wind speed and direction over Europe, drawn as streamlines."),
     ("Wind über Europa", "Windgeschwindigkeit und -richtung über Europa als Stromlinien.")),
    ("aurora", "aurora_rotation.gif", True, 0.3,
     ("Auroras over the North Pole", "Auroras over the North Pole, visualized in Python from NOAA data."),
     ("Polarlichter über dem Nordpol", "Polarlichter über dem Nordpol, in Python aus NOAA-Daten visualisiert.")),
    ("moon-phases", "moon-phases.png", False, 0,
     ("Moon phases, 2023", "The phase of the Moon for every day of 2023."),
     ("Mondphasen 2023", "Die Mondphase für jeden Tag des Jahres 2023.")),
    ("landslide-world", "80.jpg", False, 0,
     ("Landslide susceptibility", "Global landslide susceptibility, from slight to severe."),
     ("Rutschungsanfälligkeit", "Weltweite Anfälligkeit für Hangrutschungen, von gering bis hoch.")),
    ("landslide-scandinavia", "norway-land.png", False, 0,
     ("Landslide risk, Scandinavia", "Landslide risk across Scandinavia and Finland, from moderate to severe."),
     ("Rutschungsrisiko, Skandinavien", "Risiko für Hangrutschungen in Skandinavien und Finnland, von mittel bis hoch.")),
    ("drought-us", "drought5.png", False, 0,
     ("Drought in the United States", "Drought across the contiguous United States. Data: U.S. Drought Monitor, valid until November 7, 2023."),
     ("Dürre in den USA", 'Dürre in den Vereinigten Staaten (ohne Alaska und Hawaii). Daten: <span lang="en">U.S. Drought Monitor</span>, Stand 7. November 2023.')),
    ("lidar-dem", "lidar.gif", True, 0.6,
     ("From LiDAR to DSM and DEM", "From LiDAR to DSM and DEM: unveiling the hidden terrain."),
     ("Vom LiDAR zu DOM und DGM", "Vom LiDAR zu DOM und DGM: das verborgene Gelände sichtbar gemacht.")),
    ("elevation-germany", "germay.jpeg", False, 0,
     ("Elevation circles, Germany", "The elevation of Germany as a grid of circles: the larger the circle, the higher the ground."),
     ("Höhenkreise, Deutschland", "Die Höhe Deutschlands als Raster aus Kreisen: je größer der Kreis, desto höher das Gelände.")),
    ("etna", "mount_etna.png", False, 0,
     ("Mount Etna", "Mount Etna, Sicily, drawn as stacked contour layers."),
     ("Ätna", "Der Ätna auf Sizilien als gestapelte Höhenschichten.")),
    ("world-ridges", "ridge-lines (3).png", False, 0,
     ("Ridge lines of the world", "Ridge lines showing the topography of the world."),
     ("Ridgelines der Welt", "Ridgeline-Darstellung der Topografie der Welt.")),
    ("freiburg-altstadt", "freiburg4.png", False, 0,
     ("Freiburg old town", "A street map of Freiburg's old town (Altstadt)."),
     ("Freiburger Altstadt", "Stadtplan der Freiburger Altstadt.")),
    ("freiburg-streets", "osm8.png", False, 0,
     ("Street network of Freiburg", "Street network of Freiburg im Breisgau."),
     ("Straßennetz von Freiburg", "Straßennetz von Freiburg im Breisgau.")),
]

# Sharper stills for animated plates (thumbnail / preview), where a larger frame exists.
STILLS = {"storm-emir": "0055.png"}
# Animations with thin lines get a 2x upscale for the viewer; photographic ones
# (satellite time-lapses) stay at native size, where upscaling only adds megabytes.
UPSCALE = {"storm-emir"}

# Certificates, newest first: id, source, (title, caption, date) in English and German.
# Titles stay in English on both pages (official course names).
ARSET = "NASA Applied Remote Sensing Training (ARSET)"
CERTS = [
    ("cert-sar-disaster", "cer6.jpg", "Disaster Assessment Using Synthetic Aperture Radar",
     (f"{ARSET}, introductory training, October 2022.", "10/2022"),
     (f'<span lang="en">{ARSET}</span>, Einführungskurs, Oktober 2022.', "10/2022")),
    ("cert-floods", "cer3.jpg", "Monitoring and Modeling Floods using Earth Observations",
     (f"{ARSET}, intermediate training, September 2022.", "09/2022"),
     (f'<span lang="en">{ARSET}</span>, Aufbaukurs, September 2022.', "09/2022")),
    ("cert-crops-sar", "cer4.jpg", "Mapping Crops and their Biophysical Characteristics with Polarimetric SAR and Optical Remote Sensing",
     (f"{ARSET}, advanced training, April–May 2022.", "05/2022"),
     (f'<span lang="en">{ARSET}</span>, Fortgeschrittenenkurs, April–Mai 2022.', "05/2022")),
    ("cert-air-quality", "cer2.jpg", "Tools for Analyzing NASA Air Quality Model Output",
     (f"{ARSET}, March 2022.", "03/2022"),
     (f'<span lang="en">{ARSET}</span>, März 2022.', "03/2022")),
    ("cert-fire", "cer1.jpg", "Using Earth Observations for Pre- and Post-Fire Monitoring",
     (f"{ARSET}, January 2022.", "01/2022"),
     (f'<span lang="en">{ARSET}</span>, Januar 2022.', "01/2022")),
    ("cert-insar", "cer5.jpg", "InSAR Processing and Time-Series Analysis for Geophysical Applications: ISCE, ARIA-tools, and MintPy",
     ("UNAVCO / GAGE short course (NSF, NASA).", ""),
     ("Kurzlehrgang von UNAVCO / GAGE (NSF, NASA).", "")),
]

LABELS = {
    "en": {"plate": "Plate", "anim": "animation", "open": "Open", "view": "open large", "list": "Plates"},
    "de": {"plate": "Tafel", "anim": "Animation", "open": "Öffnen", "view": "groß öffnen", "list": "Tafeln"},
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
    items = [(p[0], p[1], p[2], p[3]) for p in PLATES] + [(c[0], c[1], False, 0) for c in CERTS]
    for pid, src, anim, frame in items:
        im = Image.open(ROOT / src)
        if anim:
            n = getattr(im, "n_frames", 1)
            im.seek(min(int(frame * n), n - 1))
            # The GIFs are small (600-1000 px) and dithered. A very light denoise,
            # 2x Lanczos upscaling for line art (UPSCALE; the viewer shows ~1100 px)
            # and moderate compression keep fine lines sharp; stronger settings
            # (hqdn3d 3, CRF 40) made Storm Emir blotchy.
            scale = "scale=iw*2:ih*2:flags=lanczos" if pid in UPSCALE else "scale=trunc(iw/2)*2:trunc(ih/2)*2"
            vf = "hqdn3d=1.5:1.5:2:2," + scale
            ffmpeg("-i", str(ROOT / src), "-an", "-pix_fmt", "yuv420p", "-vf", vf,
                   "-c:v", "libvpx-vp9", "-crf", "36", "-b:v", "0", "-row-mt", "1", str(OUT / f"{pid}.webm"))
            ffmpeg("-i", str(ROOT / src), "-an", "-pix_fmt", "yuv420p", "-vf", vf, "-movflags", "+faststart",
                   "-c:v", "libx264", "-preset", "slow", "-crf", "27", str(OUT / f"{pid}.mp4"))
            full = im.size
            if pid in STILLS:
                im = Image.open(ROOT / STILLS[pid])
        else:
            full = save_webp(im, OUT / f"{pid}-1600.webp", 1600, 80)
        thumb = save_webp(im, OUT / f"{pid}-720.webp", 720, 72)
        sizes[pid] = (thumb, full)
        print(f"{pid:18} thumb {thumb[0]}x{thumb[1]}  full {full[0]}x{full[1]}")
    return sizes


def cert_markup(lang, prefix):
    items = []
    for cid, src, title, en, de in CERTS:
        caption, date = en if lang == "en" else de
        base = f"{prefix}assets/plates/{cid}"
        thumb = Image.open(OUT / f"{cid}-720.webp").size
        issuer = "UNAVCO / GAGE" if "UNAVCO" in caption else "NASA ARSET"
        full_caption = f'<span lang="en">{title}</span>. {caption}' if lang == "de" else f"{title}. {caption}"
        items.append(
            f'              <li class="plate">\n'
            f'                <a href="{base}-1600.webp" class="plate-link" data-full="{base}-1600.webp" data-caption="{html.escape(full_caption, quote=True)}">\n'
            f'                  <img src="{base}-720.webp" width="{thumb[0]}" height="{thumb[1]}" loading="lazy" decoding="async" alt="">\n'
            f'                  <span class="plate-meta"><span class="plate-no">{date or "&nbsp;"}</span><span>{issuer}</span></span>\n'
            f'                  <span class="plate-title" lang="en">{title}</span>\n'
            f"                </a>\n"
            f"              </li>"
        )
    return '\n              <ol class="plates certs">\n' + "\n".join(items) + "\n              </ol>\n              "


def markup(lang, prefix):
    """Plate index: a numbered list of titles beside one large preview. site.js
    swaps the preview on hover/focus; a click opens the viewer. Phones show a
    small thumbnail in each row instead of the preview."""
    L = LABELS[lang]
    items = []
    first = None
    for i, (pid, src, anim, frame, en, de) in enumerate(PLATES, 1):
        short, caption = en if lang == "en" else de
        base = f"{prefix}assets/plates/{pid}"
        full = f"{base}.mp4" if anim else f"{base}-1600.webp"
        w, h = Image.open(OUT / f"{pid}-720.webp").size
        data = f' data-webm="{base}.webm" data-mp4="{base}.mp4"' if anim else f' data-full="{base}-1600.webp"'
        tag = f'<span class="plate-tag">{L["anim"]}</span>' if anim else ""
        no = f'{L["plate"]} {i:02d}'
        if first is None:
            first = (base, w, h, short, caption, anim)
        items.append(
            f'              <li class="plate">\n'
            f'                <a href="{full}" class="plate-link"{data} data-no="{no}" data-thumb="{base}-720.webp" data-caption="{html.escape(caption, quote=True)}">\n'
            f'                  <img src="{base}-720.webp" width="{w}" height="{h}" loading="lazy" decoding="async" alt="">\n'
            f'                  <span class="plate-no" aria-hidden="true">{i:02d}</span>\n'
            f'                  <span class="plate-title"><span class="visually-hidden">{no}: </span>{short}</span>\n'
            f"                  {tag}\n"
            f"                </a>\n"
            f"              </li>"
        )
    base, w, h, short, caption, anim = first
    tag = f'<span class="plate-tag">{L["anim"]}</span>' if anim else ""
    preview = (
        f'            <figure class="pidx-preview" aria-hidden="true">\n'
        f'              <button class="pidx-open" type="button" tabindex="-1">'
        f'<img src="{base}-720.webp" width="{w}" height="{h}" loading="lazy" decoding="async" alt=""></button>\n'
        f'              <figcaption><span class="pidx-cap">{caption}</span> <span class="pidx-hint">{L["view"]} ↗</span></figcaption>\n'
        f"            </figure>\n"
    )
    return ('\n          <div class="pidx">\n'
            f'            <ol class="plates pidx-list" aria-label="{L["list"]}">\n' + "\n".join(items) + "\n            </ol>\n"
            + preview + "          </div>\n          ")


def main():
    if "--skip-media" not in sys.argv:
        build_media()
    for path, lang, prefix in [("index.html", "en", ""), ("de/index.html", "de", "../")]:
        page = ROOT / path
        s = page.read_text()
        for key, render in (("plates", markup), ("certs", cert_markup)):
            s, n = re.subn(rf"(<!-- build:{key} -->).*?(<!-- /build:{key} -->)",
                           lambda m: m.group(1) + render(lang, prefix) + m.group(2), s, flags=re.S)
            if not n:
                sys.exit(f"no build:{key} marker in {path}")
        page.write_text(s)
        print(f"updated {path}")


if __name__ == "__main__":
    main()

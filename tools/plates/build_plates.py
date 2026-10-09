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
    # Pre-rendered videos (tools/media, src None): media already in assets/plates.
    ("lidar-flyaround", None, True, 0,
     ("LiDAR point cloud, Freudenberg",
      "Freudenberg (Siegerland) from airborne laser scanning, about 2.4 million points. The open data only "
      "separates ground from non-ground, so I classified it in three automated steps: (1) a 1 m terrain model "
      "from the ground points, with gaps under buildings filled; (2) height above ground for every point; "
      "(3) points more than 1.5 m above ground inside an official building footprint are buildings, all other "
      "points more than 0.5 m above ground are vegetation, the rest is ground. Noise points were removed. "
      "Data: Geobasis NRW (dl-de/zero-2-0)."),
     ("LiDAR-Punktwolke, Freudenberg",
      "Freudenberg (Siegerland) aus flugzeuggestütztem Laserscanning, rund 2,4 Millionen Punkte. Die offenen Daten "
      "unterscheiden nur Boden und Nicht-Boden, daher habe ich sie in drei automatisierten Schritten klassifiziert: "
      "(1) ein Geländemodell mit 1 m Auflösung aus den Bodenpunkten, Lücken unter Gebäuden gefüllt; (2) die Höhe "
      "über Grund für jeden Punkt; (3) Punkte mehr als 1,5 m über Grund innerhalb eines amtlichen Gebäudegrundrisses "
      "sind Gebäude, alle übrigen Punkte mehr als 0,5 m über Grund Vegetation, der Rest Boden. Rauschpunkte wurden "
      "entfernt. Daten: Geobasis NRW (dl-de/zero-2-0).")),
    ("ortho-buildings", None, True, 0,
     ("Orthophoto and building outlines, Freudenberg",
      "The old town of Freudenberg (Siegerland) in a 10 cm orthophoto (DOP10, 2025) with the official ALKIS "
      "building footprints. Data: Geobasis NRW (dl-de/zero-2-0)."),
     ("Orthofoto und Gebäudeumrisse, Freudenberg",
      "Die Altstadt von Freudenberg (Siegerland) im 10-cm-Orthofoto (DOP10, 2025) mit den amtlichen "
      "ALKIS-Gebäudegrundrissen. Daten: Geobasis NRW (dl-de/zero-2-0).")),
    ("ortho-errors", None, True, 0,
     ("Typical segmentation errors (simulated)",
      "Typical errors of building-segmentation models, simulated from the official footprints (white): attached "
      "houses merged into one polygon and loose outlines on complex roofs (orange). An illustration, not model "
      "output. Freudenberg, DOP10 2025. Data: Geobasis NRW (dl-de/zero-2-0)."),
     ("Typische Segmentierungsfehler (simuliert)",
      "Typische Fehler von Modellen zur Gebäudesegmentierung, simuliert aus den amtlichen Grundrissen (weiß): "
      "aneinandergebaute Häuser zu einem Polygon verschmolzen und ungenaue Umrisse bei komplexen Dächern (orange). "
      "Eine Illustration, keine Modellausgabe. Freudenberg, DOP10 2025. Daten: Geobasis NRW (dl-de/zero-2-0).")),
    ("landslide-sim", None, True, 0,
     ("Landslide simulation, Freudenberg", "A shallow-landslide scenario on real terrain (2 m elevation model from LiDAR, Freudenberg). As rain saturates the soil, the factor of safety of the infinite-slope model drops; where FS falls below 1 the slope fails. The modelled slide moves about 4 400 m³ (8 500 t) and runs out about 150 m, stopping at the empirical reach angle for its volume (Corominas 1996, 22°), routed downslope with multiple flow directions. Assumed soil: c′ = 4 kPa, φ′ = 33°, depth 1.5 m. A model scenario, not a recorded event. Data: Geobasis NRW (dl-de/zero-2-0)."),
     ("Rutschungssimulation, Freudenberg", "Ein Szenario für eine flachgründige Rutschung auf realem Gelände (2-m-Höhenmodell aus LiDAR, Freudenberg). Während Regen den Boden sättigt, sinkt der Sicherheitsfaktor des Modells der unendlichen Böschung; wo FS unter 1 fällt, versagt der Hang. Die modellierte Rutschung bewegt rund 4 400 m³ (8 500 t) und läuft etwa 150 m weit aus, bis zum empirischen Reichweitenwinkel für ihr Volumen (Corominas 1996, 22°), talwärts verteilt mit mehreren Fließrichtungen. Angenommener Boden: c′ = 4 kPa, φ′ = 33°, Mächtigkeit 1,5 m. Ein Modellszenario, kein beobachtetes Ereignis. Daten: Geobasis NRW (dl-de/zero-2-0).")),
    ("vehicle-detection", None, True, 0,
     ("Vehicle detection and tracking",
      "Vehicles detected and tracked in drone video of a highway, each with an ID and its track."),
     ("Fahrzeugerkennung und -verfolgung",
      "Fahrzeuge in einem Drohnenvideo einer Autobahn erkannt und verfolgt, jeweils mit ID und Spur.")),
    ("tree-crowns", "tree-crowns.png", False, 0,
     ("Tree crowns in an orthophoto", "Tree crowns outlined in a high-resolution orthophoto of a city."),
     ("Baumkronen im Orthofoto", "Umrisse von Baumkronen in einem hochaufgelösten Orthofoto einer Stadt.")),
    ("storm-emir", "storm.gif", True, 0.5,
     ("Storm Emir", f"Storm Emir, November 2023: wind field over Europe. Data: ERA5; {C3S}."),
     ("Sturm Emir", f'Sturm Emir, November 2023: Windfeld über Europa. Daten: ERA5; <span lang="en">{C3S}</span>.')),
    ("wind-europe", "europe9.png", False, 0,
     ("Wind over Europe", "Wind speed and direction over Europe, drawn as streamlines."),
     ("Wind über Europa", "Windgeschwindigkeit und -richtung über Europa als Stromlinien.")),
    ("aurora", "aurora_rotation.gif", True, 0.3,
     ("Auroras over the North Pole", "Auroras over the North Pole, visualized in Python from NOAA data."),
     ("Polarlichter über dem Nordpol", "Polarlichter über dem Nordpol, in Python aus NOAA-Daten visualisiert.")),
    ("landslide-scandinavia", "norway-land.png", False, 0,
     ("Landslide risk, Scandinavia", "Landslide risk across Scandinavia and Finland, from moderate to severe."),
     ("Rutschungsrisiko, Skandinavien", "Risiko für Hangrutschungen in Skandinavien und Finnland, von mittel bis hoch.")),
    ("drought-us", "drought5.png", False, 0,
     ("Drought in the United States", "Drought across the contiguous United States. Data: U.S. Drought Monitor, valid until November 7, 2023."),
     ("Dürre in den USA", 'Dürre in den Vereinigten Staaten (ohne Alaska und Hawaii). Daten: <span lang="en">U.S. Drought Monitor</span>, Stand 7. November 2023.')),
    ("population-europe", "population-europe.png", False, 0,
     ("Population density, Europe",
      "Cells of 100 m with more than 50 inhabitants across Europe. Basemap © OpenStreetMap contributors, © CARTO."),
     ("Bevölkerungsdichte, Europa",
      'Zellen von 100 m mit mehr als 50 Einwohnern in Europa. Hintergrundkarte © <span lang="en">OpenStreetMap contributors</span>, © CARTO.')),
    ("lidar-dem", "lidar.gif", True, 0.6,
     ("From LiDAR to DSM and DEM", "From LiDAR to DSM and DEM: unveiling the hidden terrain."),
     ("Vom LiDAR zu DOM und DGM", "Vom LiDAR zu DOM und DGM: das verborgene Gelände sichtbar gemacht.")),
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
     ("Straßennetz von Freiburg", "Straßennetz von Freiburg im Breisgau.")),    ("las-vegas", "lasvegas.gif", True, 0.5,
     ("Urban growth in Las Vegas", "Urban growth in Las Vegas."),
     ("Stadtwachstum in Las Vegas", "Stadtwachstum in Las Vegas.")),
    ("difference-image", "home1.gif", True, 0.5,
     ("Difference image", "Difference image."),
     ("Differenzbild", "Differenzbild.")),
    ("relief-animation", "home2.gif", True, 0.5,
     ("Shaded relief (animation)", "Shaded relief (animation)."),
     ("Schummerung (Animation)", "Schummerung (Animation).")),
    ("burn-severity", "prog3.gif", True, 0.5,
     ("Burn severity", "Burn severity."),
     ("Brandschwere", "Brandschwere.")),
    ("storm-emir-still", "storm.png", False, 0.5,
     ("Storm Emir, wind speed", "Storm Emir, wind speed."),
     ("Sturm Emir, Windgeschwindigkeit", "Sturm Emir, Windgeschwindigkeit.")),
    ("wind-speed-direction", "wind-4.png", False, 0.5,
     ("Wind speed, Europe", "Wind speed, Europe."),
     ("Windgeschwindigkeit, Europa", "Windgeschwindigkeit, Europa.")),
    ("feldberg-charts", "feldberg.png", False, 0.5,
     ("Temperature and wind charts", "Temperature and wind charts."),
     ("Temperatur- und Winddiagramme", "Temperatur- und Winddiagramme.")),
    ("moon-phases-2", "moon-phase2.png", False, 0.5,
     ("Moon phases (2)", "Moon phases (2)."),
     ("Mondphasen (2)", "Mondphasen (2).")),
    ("air-temperature", "europe.png", False, 0.5,
     ("Surface air temperature change", "Surface air temperature change."),
     ("Änderung der Lufttemperatur", "Änderung der Lufttemperatur.")),
    ("polar-temperature", "globe.png", False, 0.5,
     ("Temperature change at the poles", "Temperature change at the poles."),
     ("Temperaturänderung an den Polen", "Temperaturänderung an den Polen.")),
    ("freiburg-lst", "temp2.png", False, 0.5,
     ("Land surface temperature, Freiburg", "Land surface temperature, Freiburg."),
     ("Landoberflächen&shy;temperatur, Freiburg", "Landoberflächen&shy;temperatur, Freiburg.")),
    ("freiburg-precipitation", "precipitation.png", False, 0.5,
     ("Monthly precipitation, Freiburg", "Monthly precipitation, Freiburg."),
     ("Monatlicher Niederschlag, Freiburg", "Monatlicher Niederschlag, Freiburg.")),
    ("leaf-area", "leafarea.png", False, 0.5,
     ("Precipitation and leaf area index", "Precipitation and leaf area index."),
     ("Niederschlag und Blattflächenindex", "Niederschlag und Blattflächenindex.")),
    ("landslide-world-dark", "landlside-final.png", False, 0.5,
     ("Landslide risk, world (dark)", "Landslide risk, world (dark)."),
     ("Rutschungsrisiko, Welt (dunkel)", "Rutschungsrisiko, Welt (dunkel).")),
    ("landslide-scandinavia-2", "simplee.png", False, 0.5,
     ("Landslide risk, Scandinavia (2)", "Landslide risk, Scandinavia (2)."),
     ("Rutschungsrisiko, Skandinavien (2)", "Rutschungsrisiko, Skandinavien (2).")),
    ("kinematics", "kine.JPG", False, 0.5,
     ("Kinematic analysis", "Kinematic analysis."),
     ("Kinematische Analyse", "Kinematische Analyse.")),
    ("europe-ridges", "europe-ridge-lines.png", False, 0.5,
     ("Ridge lines of Europe", "Ridge lines of Europe."),
     ("Ridgelines Europas", "Ridgelines Europas.")),
    ("ridge-art", "freiburg7.jpeg", False, 0.5,
     ("Ridge-line study", "Ridge-line study."),
     ("Ridgeline-Studie", "Ridgeline-Studie.")),
    ("elevation-italy", "elevation.jpg", False, 0.5,
     ("Elevation circles, Italy", "Elevation circles, Italy."),
     ("Höhenkreise, Italien", "Höhenkreise, Italien.")),
    ("elevation-italy-2", "elevation.png", False, 0.5,
     ("Elevation circles, Italy (2)", "Elevation circles, Italy (2)."),
     ("Höhenkreise, Italien (2)", "Höhenkreise, Italien (2).")),
    ("relief-1", "freiburg1.jpeg", False, 0.5,
     ("Shaded relief map", "Shaded relief map."),
     ("Schummerungskarte", "Schummerungskarte.")),
    ("munich-1", "munich2.jpeg", False, 0.5,
     ("Munich street map", "Munich street map."),
     ("Stadtplan München", "Stadtplan München.")),
    ("us-hex", "ustates11.png", False, 0.5,
     ("United States, hexagon map", "United States, hexagon map."),
     ("USA, Hexagonkarte", "USA, Hexagonkarte.")),
    ("world-tour", "world-tour3.png", False, 0.5,
     ("“World tour” map", "“World tour” map."),
     ("„World Tour“-Karte", "„World Tour“-Karte.")),
    ("utm-zones", "download.png", False, 0.5,
     ("UTM zones", "UTM zones."),
     ("UTM-Zonen", "UTM-Zonen.")),
    ("qgis-buildings", "glacier1.JPG", False, 0.5,
     ("QGIS: building footprints", "QGIS: building footprints."),
     ("QGIS: Gebäudegrundrisse", "QGIS: Gebäudegrundrisse.")),
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
        if src is None:  # pre-rendered by tools/media
            continue
        im = Image.open(ROOT / src)
        if anim:
            n = getattr(im, "n_frames", 1)
            im.seek(min(int(frame * n), n - 1))
            # The GIFs are small (600-1000 px) and dithered. A very light denoise,
            # 2x Lanczos upscaling for line art (UPSCALE; the viewer shows ~1100 px)
            # and moderate compression keep fine lines sharp; stronger settings
            # (hqdn3d 3, CRF 40) made Storm Emir blotchy.
            scale = ("scale=iw*2:ih*2:flags=lanczos" if pid in UPSCALE
                     else "scale='trunc(min(1600,iw)/2)*2':-2:flags=lanczos")
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

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
    ("wind-speed-2", "wind-speed2.png", False, 0.5,
     ("Wind speed and direction, Europe", "Wind speed and direction, Europe."),
     ("Windgeschwindigkeit und -richtung, Europa", "Windgeschwindigkeit und -richtung, Europa.")),
    ("wind-speed-3", "wind-speed3.png", False, 0.5,
     ("Wind speed, Europe (contours)", "Wind speed, Europe (contours)."),
     ("Windgeschwindigkeit, Europa (Flächen)", "Windgeschwindigkeit, Europa (Flächen).")),
    ("wind-arrows", "wind5.png", False, 0.5,
     ("Wind arrows, Europe", "Wind arrows, Europe."),
     ("Windpfeile, Europa", "Windpfeile, Europa.")),
    ("wind-rose", "wind007.png", False, 0.5,
     ("Wind rose, Freiburg", "Wind rose, Freiburg."),
     ("Windrose, Freiburg", "Windrose, Freiburg.")),
    ("wind-rose-2", "wind2.png", False, 0.5,
     ("Wind rose", "Wind rose."),
     ("Windrose", "Windrose.")),
    ("feldberg-charts", "feldberg.png", False, 0.5,
     ("Temperature and wind charts", "Temperature and wind charts."),
     ("Temperatur- und Winddiagramme", "Temperatur- und Winddiagramme.")),
    ("aurora-north", "auro2.png", False, 0.5,
     ("Aurora, North Pole", "Aurora, North Pole."),
     ("Polarlicht, Nordpol", "Polarlicht, Nordpol.")),
    ("aurora-panels", "aurora.jpg", False, 0.5,
     ("Aurora data, both poles", "Aurora data, both poles."),
     ("Polarlichtdaten, beide Pole", "Polarlichtdaten, beide Pole.")),
    ("aurora-panels-2", "aurora2.jpg", False, 0.5,
     ("Aurora data, both poles (2)", "Aurora data, both poles (2)."),
     ("Polarlichtdaten, beide Pole (2)", "Polarlichtdaten, beide Pole (2).")),
    ("aurora-panels-3", "aurora21.png", False, 0.5,
     ("Aurora data, both poles (3)", "Aurora data, both poles (3)."),
     ("Polarlichtdaten, beide Pole (3)", "Polarlichtdaten, beide Pole (3).")),
    ("aurora-north-2", "aurot.png", False, 0.5,
     ("Aurora, North Pole (2)", "Aurora, North Pole (2)."),
     ("Polarlicht, Nordpol (2)", "Polarlicht, Nordpol (2).")),
    ("moon-phases-2", "moon-phase2.png", False, 0.5,
     ("Moon phases (2)", "Moon phases (2)."),
     ("Mondphasen (2)", "Mondphasen (2).")),
    ("temp-difference", "Unbenannt.png", False, 0.5,
     ("Temperature difference, 1980–2000 and 2000–2018", "Temperature difference, 1980–2000 and 2000–2018."),
     ("Temperaturdifferenz, 1980–2000 und 2000–2018", "Temperaturdifferenz, 1980–2000 und 2000–2018.")),
    ("air-temperature", "europe.png", False, 0.5,
     ("Surface air temperature change", "Surface air temperature change."),
     ("Änderung der Lufttemperatur", "Änderung der Lufttemperatur.")),
    ("polar-temperature", "globe.png", False, 0.5,
     ("Temperature change at the poles", "Temperature change at the poles."),
     ("Temperaturänderung an den Polen", "Temperaturänderung an den Polen.")),
    ("freiburg-lst", "temp2.png", False, 0.5,
     ("Land surface temperature, Freiburg", "Land surface temperature, Freiburg."),
     ("Landoberflächen&shy;temperatur, Freiburg", "Landoberflächen&shy;temperatur, Freiburg.")),
    ("freiburg-temperature", "averag.png", False, 0.5,
     ("Average temperature, Freiburg", "Average temperature, Freiburg."),
     ("Mitteltemperatur, Freiburg", "Mitteltemperatur, Freiburg.")),
    ("freiburg-precipitation", "precipitation.png", False, 0.5,
     ("Monthly precipitation, Freiburg", "Monthly precipitation, Freiburg."),
     ("Monatlicher Niederschlag, Freiburg", "Monatlicher Niederschlag, Freiburg.")),
    ("temp-vs-prec", "tempvsprec.png", False, 0.5,
     ("Temperature and precipitation", "Temperature and precipitation."),
     ("Temperatur und Niederschlag", "Temperatur und Niederschlag.")),
    ("leaf-area", "leafarea.png", False, 0.5,
     ("Precipitation and leaf area index", "Precipitation and leaf area index."),
     ("Niederschlag und Blattflächenindex", "Niederschlag und Blattflächenindex.")),
    ("biomass", "prog11.jpg", False, 0.5,
     ("Above-ground biomass models", "Above-ground biomass models."),
     ("Modelle der oberirdischen Biomasse", "Modelle der oberirdischen Biomasse.")),
    ("landslide-world-dark", "landlside-final.png", False, 0.5,
     ("Landslide risk, world (dark)", "Landslide risk, world (dark)."),
     ("Rutschungsrisiko, Welt (dunkel)", "Rutschungsrisiko, Welt (dunkel).")),
    ("landslide-scandinavia-2", "simplee.png", False, 0.5,
     ("Landslide risk, Scandinavia (2)", "Landslide risk, Scandinavia (2)."),
     ("Rutschungsrisiko, Skandinavien (2)", "Rutschungsrisiko, Skandinavien (2).")),
    ("landslide-sim", "prog1.jpg", False, 0.5,
     ("Landslide simulation", "Landslide simulation."),
     ("Erdrutsch-Simulation", "Erdrutsch-Simulation.")),
    ("dem-3d", "prog2.jpg", False, 0.5,
     ("3D terrain with a flow path", "3D terrain with a flow path."),
     ("3D-Gelände mit Fließweg", "3D-Gelände mit Fließweg.")),
    ("factor-of-safety", "fo.png", False, 0.5,
     ("Factor of safety", "Factor of safety."),
     ("Sicherheitsfaktor", "Sicherheitsfaktor.")),
    ("susceptibility", "pro.png", False, 0.5,
     ("Landslide susceptibility, local", "Landslide susceptibility, local."),
     ("Rutschungsanfälligkeit, lokal", "Rutschungsanfälligkeit, lokal.")),
    ("slope", "slope.png", False, 0.5,
     ("Slope map", "Slope map."),
     ("Hangneigungskarte", "Hangneigungskarte.")),
    ("aspect", "aspect.png", False, 0.5,
     ("Aspect map", "Aspect map."),
     ("Expositionskarte", "Expositionskarte.")),
    ("kinematics", "kine.JPG", False, 0.5,
     ("Kinematic analysis", "Kinematic analysis."),
     ("Kinematische Analyse", "Kinematische Analyse.")),
    ("europe-ridges", "europe-ridge-lines.png", False, 0.5,
     ("Ridge lines of Europe", "Ridge lines of Europe."),
     ("Ridgelines Europas", "Ridgelines Europas.")),
    ("ridge-art", "freiburg7.jpeg", False, 0.5,
     ("Ridge-line study", "Ridge-line study."),
     ("Ridgeline-Studie", "Ridgeline-Studie.")),
    ("etna-2", "mountetna2.jpg", False, 0.5,
     ("Mount Etna (2)", "Mount Etna (2)."),
     ("Ätna (2)", "Ätna (2).")),
    ("elevation-germany-2", "germany4.jpeg", False, 0.5,
     ("Elevation circles, Germany (2)", "Elevation circles, Germany (2)."),
     ("Höhenkreise, Deutschland (2)", "Höhenkreise, Deutschland (2).")),
    ("elevation-hex", "elev.jpeg", False, 0.5,
     ("Elevation hexagons, Germany", "Elevation hexagons, Germany."),
     ("Höhen-Hexagone, Deutschland", "Höhen-Hexagone, Deutschland.")),
    ("elevation-hex-2", "elev2.jpeg", False, 0.5,
     ("Elevation hexagons, Germany (2)", "Elevation hexagons, Germany (2)."),
     ("Höhen-Hexagone, Deutschland (2)", "Höhen-Hexagone, Deutschland (2).")),
    ("elevation-hex-3", "elevations2.jpg", False, 0.5,
     ("Elevation hexagons, Germany (3)", "Elevation hexagons, Germany (3)."),
     ("Höhen-Hexagone, Deutschland (3)", "Höhen-Hexagone, Deutschland (3).")),
    ("elevation-italy", "elevation.jpg", False, 0.5,
     ("Elevation circles, Italy", "Elevation circles, Italy."),
     ("Höhenkreise, Italien", "Höhenkreise, Italien.")),
    ("elevation-italy-2", "elevation.png", False, 0.5,
     ("Elevation circles, Italy (2)", "Elevation circles, Italy (2)."),
     ("Höhenkreise, Italien (2)", "Höhenkreise, Italien (2).")),
    ("elevation-dots", "elevations.jpg", False, 0.5,
     ("Elevation dots", "Elevation dots."),
     ("Höhenpunkte", "Höhenpunkte.")),
    ("relief-1", "freiburg1.jpeg", False, 0.5,
     ("Shaded relief map", "Shaded relief map."),
     ("Schummerungskarte", "Schummerungskarte.")),
    ("relief-2", "freiburg2.jpeg", False, 0.5,
     ("Shaded relief map (2)", "Shaded relief map (2)."),
     ("Schummerungskarte (2)", "Schummerungskarte (2).")),
    ("freiburg-circle", "freiburg5.jpeg", False, 0.5,
     ("Freiburg street map", "Freiburg street map."),
     ("Stadtplan Freiburg", "Stadtplan Freiburg.")),
    ("munich-1", "munich2.jpeg", False, 0.5,
     ("Munich street map", "Munich street map."),
     ("Stadtplan München", "Stadtplan München.")),
    ("munich-2", "munich5.jpeg", False, 0.5,
     ("Munich street map (2)", "Munich street map (2)."),
     ("Stadtplan München (2)", "Stadtplan München (2).")),
    ("munich-3", "munichen.jpg", False, 0.5,
     ("Munich street maps", "Munich street maps."),
     ("Stadtpläne München", "Stadtpläne München.")),
    ("sicily", "map.jpg", False, 0.5,
     ("Map of Sicily", "Map of Sicily."),
     ("Karte von Sizilien", "Karte von Sizilien.")),
    ("germany-districts", "home3.jpg", False, 0.5,
     ("Germany, district map", "Germany, district map."),
     ("Deutschland, Kreiskarte", "Deutschland, Kreiskarte.")),
    ("germany-choropleth", "home4.jpg", False, 0.5,
     ("Germany, choropleth map", "Germany, choropleth map."),
     ("Deutschland, Choroplethenkarte", "Deutschland, Choroplethenkarte.")),
    ("us-hex", "ustates11.png", False, 0.5,
     ("United States, hexagon map", "United States, hexagon map."),
     ("USA, Hexagonkarte", "USA, Hexagonkarte.")),
    ("iceland-walk", "badmap36.png", False, 0.5,
     ("Can you walk to Iceland?", "Can you walk to Iceland?"),
     ("Kann man nach Island laufen?", "Kann man nach Island laufen?")),
    ("world-tour", "world-tour3.png", False, 0.5,
     ("“World tour” map", "“World tour” map."),
     ("„World Tour“-Karte", "„World Tour“-Karte.")),
    ("projections", "projections.png", False, 0.5,
     ("Map projections", "Map projections."),
     ("Kartenprojektionen", "Kartenprojektionen.")),
    ("utm-zones", "download.png", False, 0.5,
     ("UTM zones", "UTM zones."),
     ("UTM-Zonen", "UTM-Zonen.")),
    ("night-lights", "urban-areas.jpeg", False, 0.5,
     ("Urban areas at night", "Urban areas at night."),
     ("Siedlungsgebiete bei Nacht", "Siedlungsgebiete bei Nacht.")),
    ("wildfire", "home1.jpg", False, 0.5,
     ("Active fire and burn scar", "Active fire and burn scar."),
     ("Aktives Feuer und Brandnarbe", "Aktives Feuer und Brandnarbe.")),
    ("earthquake-cities", "home2.jpg", False, 0.5,
     ("Nurdağı, Kahramanmaraş, Türkoğlu", "Nurdağı, Kahramanmaraş, Türkoğlu."),
     ("Nurdağı, Kahramanmaraş, Türkoğlu", "Nurdağı, Kahramanmaraş, Türkoğlu.")),
    ("marree-man", "marreeman.jpg", False, 0.5,
     ("Marree Man", "Marree Man."),
     ("Marree Man", "Marree Man.")),
    ("glacier-outlines", "glacier3.JPG", False, 0.5,
     ("Mýrdalsjökull outlines", "Mýrdalsjökull outlines."),
     ("Umrisse des Mýrdalsjökull", "Umrisse des Mýrdalsjökull.")),
    ("solheimajokull", "glacier4.JPG", False, 0.5,
     ("Sólheimajökull outlines", "Sólheimajökull outlines."),
     ("Umrisse des Sólheimajökull", "Umrisse des Sólheimajökull.")),
    ("qgis-buildings", "glacier1.JPG", False, 0.5,
     ("QGIS: building footprints", "QGIS: building footprints."),
     ("QGIS: Gebäudegrundrisse", "QGIS: Gebäudegrundrisse.")),
    ("qgis-grid", "glacier2.JPG", False, 0.5,
     ("QGIS: grid map over imagery", "QGIS: grid map over imagery."),
     ("QGIS: Rasterkarte über Luftbild", "QGIS: Rasterkarte über Luftbild.")),
    ("web-map", "2.jpg", False, 0.5,
     ("Web map application", "Web map application."),
     ("Webkarten-Anwendung", "Webkarten-Anwendung.")),
    ("web-map-2", "3.jpg", False, 0.5,
     ("Web map application (2)", "Web map application (2)."),
     ("Webkarten-Anwendung (2)", "Webkarten-Anwendung (2).")),
    ("qgis-chart", "qgis.jpg", False, 0.5,
     ("The marvels of QGIS", "The marvels of QGIS."),
     ("The marvels of QGIS", "The marvels of QGIS.")),
    ("front-door", "fear.png", False, 0.5,
     ("Walking back to my front door at night", "Walking back to my front door at night."),
     ("Walking back to my front door at night", "Walking back to my front door at night.")),
    ("satellite-drawing", "satellite.png", False, 0.5,
     ("Satellite drawing", "Satellite drawing."),
     ("Satellitenzeichnung", "Satellitenzeichnung.")),
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

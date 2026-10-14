#!/usr/bin/env python3
"""Faint contour band for the PDF/print CV header (assets/topo/cv-contours.svg).

    python3 tools/cv/make_cv_contours.py

A label-free crop of the hero contours (assets/topo/hero-contours.svg): the Black Forest edge north-east of
Freiburg, about the header's aspect. CSS lays it across the whole header, fading in from the left, so the hills
sit behind the QR code and the name stays clean (owner, 2026-10-14; ridge lines were tried and looked weird).
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC, OUT = ROOT / "assets" / "topo" / "hero-contours.svg", ROOT / "assets" / "topo" / "cv-contours.svg"
X0, Y0, W, H = 4400, 250, 5600, 1200          # map metres

paths = re.findall(r'<path d="([^"]+)"', SRC.read_text())    # minor contours, then index contours
OUT.write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{X0} {Y0} {W} {H}" preserveAspectRatio="xMidYMid slice">'
               '<style>path{fill:none;stroke:#8a6a4a;stroke-linejoin:round}</style>'
               f'<path stroke-width="4" d="{paths[0]}"/><path stroke-width="10" d="{paths[1]}"/></svg>')
print(f"{OUT.name}: {OUT.stat().st_size / 1024:.0f} KB")

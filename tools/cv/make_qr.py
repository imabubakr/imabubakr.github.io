#!/usr/bin/env python3
"""QR code to the website in the printed / PDF CV header (owner, 2026-10-14).

    python3 -m venv /tmp/qrenv && /tmp/qrenv/bin/pip install segno       # once
    /tmp/qrenv/bin/python tools/cv/make_qr.py index.html de/index.html

Writes an inline SVG (one path, no external request) between the <!-- build:cv-qr --> markers next to the
portrait in .print-head: the English page links to the English site, the German page to /de/. Print only (the
header is hidden on screen). Change SITE when the site moves to its own domain, then rerun this and
tools/cv/make_cv_pdf.mjs.
"""
import re
import sys
from pathlib import Path

import segno

SITE = "https://imabubakr.github.io/"
LABEL = {"en": "Website", "de": "Website"}

for page in sys.argv[1:]:
    p = Path(page)
    html = p.read_text()
    lang = re.search(r'<html lang="(\w+)"', html).group(1)
    url = SITE + ("de/" if lang == "de" else "")
    qr = segno.make(url, error="m", micro=False)
    n = qr.symbol_size(border=0)[0]
    d = []
    for y, row in enumerate(qr.matrix):                    # one path of unit squares, merged per row run
        x = 0
        while x < len(row):
            if row[x]:
                x0 = x
                while x < len(row) and row[x]:
                    x += 1
                d.append(f"M{x0} {y}h{x - x0}v1h-{x - x0}z")
            else:
                x += 1
    svg = (f'<figure class="print-qr"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n} {n}" '
           f'shape-rendering="crispEdges" aria-hidden="true"><path d="{"".join(d)}"/></svg>'
           f'<figcaption>{LABEL[lang]}</figcaption></figure>')
    if "<!-- build:cv-qr -->" not in html:
        img = re.search(r'\n(\s*)<img src="[^"]*portrait-320\.webp"[^>]*>', html)
        html = html[:img.start()] + f"\n{img.group(1)}<!-- build:cv-qr --><!-- /build:cv-qr -->" + html[img.start():]
    html = re.sub(r"<!-- build:cv-qr -->.*?<!-- /build:cv-qr -->",
                  lambda m: f"<!-- build:cv-qr -->{svg}<!-- /build:cv-qr -->", html, flags=re.S)
    p.write_text(html)
    print(f"{page}: QR for {url} ({n} x {n} modules)")

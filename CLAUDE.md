# imabubakr.github.io

Personal site of Muhammad Abu Bakar (Geospatial Data Specialist, Freiburg).
One page per language: English at `/` (`index.html`), German at `/de/` (`de/index.html`).

## Deploy and run

- GitHub Pages, classic mode: the root of `main` is published as-is (`.nojekyll`, no build step).
  Pushing to `main` puts changes live at https://imabubakr.github.io/.
- Local preview: `python3 -m http.server 8000` in the repo root, then open `localhost:8000/` and `localhost:8000/de/`.
- Old URLs are redirect stubs and must keep working: `about.html` → `/#about`; `resume.html`, `contact.html`,
  `projects.html` → `/#cv`; `geo.html` → `/`. Keep section ids (`about`, `cv`, `contact`) stable; both languages share them.

## Files

- `assets/css/site.css`: all styles. Tokens at the top; sections marked with `/* --- name -- */` banners.
- `assets/js/site.js`: theme toggle, nav highlight, language switch keeps the current `#section`, looping-figure controls.
- `assets/topo/hero-contours.{svg,json}`: generated. Don't edit by hand.
- `assets/img/`: portrait (WebP, 200/400 px) and `og.png` (social preview).
- `assets/media/storm-emir.*`: Storm Emir animation, currently not on the page (the user may want it back elsewhere).
- Repo-root images (`*.png`, `*.jpg`, `*.gif`…) are the old site's gallery. Which ones to keep or remove is
  still to be decided with the user. Don't delete them on your own.

## Hero map pipeline

1. `cd tools/contours && npm ci` (once). Needs GDAL ≥ 3.6 with Python bindings and numpy.
2. `tools/contours/make_contours.sh` downloads Copernicus GLO-30 around 47.997791 N, 7.842609 E, reprojects to
   WGS 84 / UTM 32N, smooths, runs `gdal_contour` (10 m, every 5th = index), simplifies with mapshaper, places
   uphill-facing labels, runs SVGO. See `--help` for options (`--dem` for a local DEM).
3. `python3 tools/contours/build_hero.py index.html de/index.html` injects the map, graticule ticks, coordinates and
   footer values between the `<!-- build:name -->` markers, formatted per `<html lang>`.
4. If the hero changed visibly, regenerate `assets/img/og.png` with `tools/og/make_og.mjs` (instructions in the file).

Licence statements (Copernicus DEM, and C3S for ERA5 if the storm figure returns) stay **verbatim in English**,
also on the German page (marked `lang="en"`).

## Design rules

The look is "technical survey sheet", deliberately toned down: the cartographic character lives in the hero map,
the mono labels and the scale bar. Everything else is quiet. The user prefers calm and centred over decorative.

### Palette (CSS custom properties; never hard-code colours)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#e9eae6` | `#0e1215` | background |
| `--ink` | `#141719` | `#e4e6e7` | text, work markers |
| `--muted` | `#4e5358` | `#8d979e` | secondary text, dates, labels |
| `--contour` | `#8a6a4a` | `#6c7f8c` | contour lines, education markers |
| `--grid` | `#c9cbc5` | `#232c33` | hairlines (nav, strip, footer), graticule |
| `--accent` | `#b8380c` | `#ff6a2b` | links and accent **text** |
| `--accent-mark` | `#d2410f` | `#ff6a2b` | non-text: location marker, current-job marker, focus ring |

- Light `--accent` is darkened from the spec's `#D2410F` (3.9:1) to `#B8380C` (4.8:1) for WCAG AA text contrast.
- Accent is used sparingly: location/"you are here" markers, links, focus. Nothing else.
- Dark mode: `prefers-color-scheme`, overridden by `html[data-theme]` from the toggle (stored in `localStorage.theme`).
  Any new token must be defined in all three places (`:root`, the media query, `[data-theme="dark"]`).

### Typography

- IBM Plex Sans (text, headings) and IBM Plex Mono (nav, numbers, dates, coordinates, labels, metadata).
  Self-hosted latin-subset woff2 in `assets/fonts/`. **Only weights 400 and 500.** No other fonts.
- Hero `h1`: 500, very large, `letter-spacing: -0.045em`, `line-height: 0.92`.
- Section titles: Plex Sans 500, `clamp(2rem, …, 3.25rem)`, `letter-spacing: -0.035em`, with a small mono `[0n]` above.
- Mono is for metadata only: never for running text.
- Centre only short text (headings, one-liners, at most about 3 lines; use `text-wrap: balance`). Longer text is
  left-aligned, even inside centred columns.

### Layout

- No page frame, no boxes, no cards, no rounded corners, no shadows, no gradients. The only lines are `--grid`
  hairlines (under the nav, under the hero strip, above the footer) and the timeline line. Don't add more.
- Mobile first; the content column is max 860 px. Every section opens the same way on the page's centre axis:
  `header.section-head` → mono `.section-no` + `h2.section-title` + optional one-line `.section-sub`.
- Order of the page: hero (who) → About (story + timeline) → CV (details) → Contact (action) → footer collar.
- Nav: mono, `[01] about  [02] cv  [03] contact`; the current section gets an underline and an accent number.
  The hero strip says `SHEET 01 / 03` (`BLATT` in German). Update both if sections are added.
- Hero: real contours (hero only, faint), graticule meridians, top strip with sheet number, longitude ticks and
  `EPSG:4326`. Coordinates and elevation in the accent next to the diamond marker.
- About: short centred lead + one supporting sentence, portrait, then a vertical timeline. Timeline: a centre
  line that starts at the first phase label (not at the photo); `EDUCATION`/`CAREER` labels sit on the line;
  entries alternate sides (`.tl-l`/`.tl-r`) with diamond markers and short connectors; the current job is
  `.tl-now` (accent). On phones entries stack on the centre line.
- CV: German Lebenslauf layout, kept **short and tight**: date column (mono, `MM/YYYY`) + entry; role and
  employer on one line (`.cv-org`); reverse chronological; key-value rows for skills and languages. No rules
  between rows. Projects belong in the CV (under the job or "Academic projects"), not in a separate section.
- Footer collar: scale bar (1 km at the hero map's on-screen scale), `WGS 84 / UTM 32N · CI 10 m`, legal lines,
  DEM credit.
- Motion: smooth scrolling (only without `prefers-reduced-motion`) and subtle hovers. Nothing else.

### Content and languages

- Never invent facts (dates, tools, numbers, sensors). Ask the user and list open questions instead.
- Every content change goes into **both** `index.html` and `de/index.html`.
- German: correct German CV conventions ("seit 11/2025", Berufserfahrung, Ausbildung, Kenntnisse,
  Sprachkenntnisse), decimal commas, `O` for east, formal "Sie". Keep official English job titles, degree,
  course and thesis names (thesis titles in „…“), marked `lang="en"`. No `hyphens: auto` (browsers split German
  compounds badly); use `&shy;` in long headings.
- US English spelling on the English page (matches the original CV).

### Accessibility and performance

- Semantic landmarks, one `h1`, skip link, visible `:focus-visible` outline, touch targets ≥ 24 px,
  decorative SVG `aria-hidden`, real `alt` text, WCAG AA contrast in both themes.
- No third-party requests (fonts, scripts, analytics). Images as WebP with `width`/`height`, `loading="lazy"` below the fold.
- Last Lighthouse run (2026-10): accessibility, best practices, SEO 100; performance 99–100 (EN and DE, mobile and desktop).

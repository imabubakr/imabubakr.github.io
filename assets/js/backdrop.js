// Page background: a low flight over the Black Forest. Ridge lines of the region
// DEM, drawn in perspective on a fixed canvas behind the page. Scrolling flies a
// straight line from Freiburg to the Feldberg; the page bottom ends looking at the
// Feldberg summit. The heading never changes, so every ridge line is fixed in the
// landscape and only comes closer (a turning camera made them morph). The camera
// eases towards the scroll position, near ridges are drawn stronger than far ones,
// summits in sight get map labels, and a small readout (wide screens, bottom-left)
// says what it is.
//
// Section [02] "From orbit to drone": while its chapters scroll past, the camera
// climbs to orbit (Earth's limb, 5° graticule, country outlines) and watches a
// Sentinel-2 pass over Freiburg (the swath fills in behind a moving scan line and
// satellite), descends to ~1 km
// looking straight down and hovers while a row of aerial photos is taken over
// Wiehre (OpenStreetMap water, roads and buildings appear inside them, drawn like a
// card model), then tilts forward at drone height (a camera viewfinder). The keyframes sit on the chapters' real positions; an
// altimeter on the right edge follows the height, and the active chapter is
// emphasised. Reduced motion: one still frame, chapters as a plain list.
//
// Data: assets/topo/region-contours.{json,dem.bin} (400 x 360 cells of 100 m,
// x east, y south, row 0 = north); assets/topo/earth.json (Natural Earth,
// tools/orbit/build_earth.py) and assets/topo/aerial-features.json
// (OpenStreetMap, tools/orbit/build_aerial.py), loaded when [02] comes near.
(function () {
  var root = document.documentElement;
  var hero = document.querySelector("[data-topo]");
  var base = hero ? hero.getAttribute("data-topo") : "assets/topo/";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  var orbit = document.getElementById("orbit");
  var footer = document.querySelector(".collar");
  var contact = document.getElementById("contact");
  var chapters = orbit ? Array.prototype.slice.call(orbit.querySelectorAll(".ds-ch")) : [];
  var de = root.lang === "de";

  // Straight route through Freiburg to the Feldberg, starting 6 km before Freiburg.
  var FREIBURG = [23143, 18541], FELDBERG = [34350, 32250];
  var UX, UY, OX, OY, ROUTE_LEN;
  (function () {
    var vx = FELDBERG[0] - FREIBURG[0], vy = FELDBERG[1] - FREIBURG[1], n = Math.hypot(vx, vy);
    UX = vx / n; UY = vy / n;
    OX = FREIBURG[0] - UX * 6000; OY = FREIBURG[1] - UY * 6000;
    ROUTE_LEN = n + 6000;
  })();
  var RX = -UY, RY = UX;     // to the right of the heading
  var ROUTE_BRG = (Math.atan2(UX, -UY) * 180) / Math.PI; // route bearing from north (x east, y south)
  var END_GAP = 5000;        // the flight stops this far before the Feldberg
  var EX = 2.6, H0 = 170;    // vertical exaggeration, base level (m)
  var ex = EX;               // exaggeration in use: EX x the descent's boost (set per frame)
  var STEP = 150, FAR = 14000;
  var CRUISE = 1300;         // height above the highest ground ahead (scene m)
  var ARRIVE_PITCH = 30, ARRIVE_CLIMB = 1500; // contact: look down onto the Feldberg
  var ARRIVE_ZOOM = 0.7;     // contact: wider lens (focal length x 0.7)
  var ARRIVE_RELIEF = 0.55;  // contact: relief factor (EX x 0.55 = ~1.4x real, for the Feldberg point cloud)
  // The finale (finale.js), once the plates have scrolled away: the camera moves FIN_FORWARD m closer to the
  // Feldberg, a little lower, with a longer lens (not closer: the whole cloud stays in view, clear of the
  // footer and with sky for its label), while the point cloud builds up and rises.
  var FIN_FORWARD = 1500, FIN_CLIMB = -300, FIN_ZOOM = 1.38, FIN_LIFT = 0.11;
  var FIN_LINES = 0.92;      // the ridge lines fade out (the old map gives way) as the point cloud rises
  var R_EARTH = 6371000;
  var CENTER_LL = [48.0, 7.81], CENTER_XY = [20000, 18000]; // region centre
  var ORBIT_H = 705000, AERIAL_H = 1000, DRONE_H = 100;     // as in the chapters' spec lines
  var S2_TRACK = 13, S2_HALF = 145000; // Sentinel-2: ground track ~13° east of north here, 290 km swath
  // The satellite pass: a descending (north to south) pass over Freiburg while chapter 1 is on screen; the
  // swath fills in behind the scan line. PASS_FROM: where along the track (m north of Freiburg) it starts.
  var PASS_FROM = 2600e3;
  // Aerial survey during chapter 2: one row of 7 photos (0.6 x 0.4 km, illustrative; 25 % forward overlap,
  // owner's figure), fixed in the landscape around SURVEY_AT.
  var SV = { fa: 400, fl: 600, da: 300, n: 7 };
  var SURVEY_AT = 6900;      // the survey's route position: over Wiehre, ~1 km south-east of the old town

  var T = de
    ? { title: "Flug über den Schwarzwald", arrived: "Am Feldberg angekommen", route: "Freiburg → Feldberg", 
        alt: "Höhe", E: "O", dec: ",",
        swath: "SENTINEL-2 · AUFNAHMEBREITE 290 KM", frames: "LUFTBILD · 20 CM",
        corridor: "DROHNENKAMERA · ~2 CM", platforms: ["Satellit", "Flugzeug", "Drohne"] }
    : { title: "Flight over the Black Forest", arrived: "Arrived at the Feldberg", route: "Freiburg → Feldberg", 
        alt: "alt", E: "E", dec: ".",
        swath: "SENTINEL-2 · 290 KM SWATH", frames: "AERIAL PHOTO · 20 CM",
        corridor: "DRONE CAMERA · ~2 CM", platforms: ["satellite", "aircraft", "drone"] };

  var canvas = document.createElement("canvas");
  canvas.className = "backdrop";
  canvas.setAttribute("aria-hidden", "true");
  var ctx = canvas.getContext("2d");
  var w = 0, h = 0, dpr = 1;
  var dem = null, meta = null, earth = null, earthLoading = false, feats = null;
  var cur = null, last = 0, running = false, lastFade = "";
  var keys = null, zones = [0.33, 0.66], surveyS = 0, surveyT = [0, 1], hold = null;
  var hud = document.createElement("p");
  hud.className = "flight-hud";
  hud.setAttribute("aria-hidden", "true");
  hud.innerHTML = '<span class="fh-title"></span><span></span><span class="fh-pos"></span>';

  // ---------------------------------------------------------- altimeter --
  var LOG_TOP = 6, LOG_BOT = 1.7; // 1000 km ... 50 m
  function altiY(m) { return (100 * (LOG_TOP - Math.log10(m))) / (LOG_TOP - LOG_BOT); }
  var alti = document.createElement("div");
  alti.className = "ds-alti";
  alti.setAttribute("aria-hidden", "true");
  alti.innerHTML =
    [[ORBIT_H, T.platforms[0] + " 705 km", 0], [100000, "100 km"], [10000, "10 km"],
      [AERIAL_H, T.platforms[1] + " 1 km", 1], [DRONE_H, T.platforms[2] + " 100 m", 2]]
      .map(function (t) {
        return '<span class="ds-alti-tick' + (t.length > 2 ? ' is-platform" data-i="' + t[2] : "") +
          '" style="top:' + altiY(t[0]).toFixed(2) + '%">' + t[1] + "</span>";
      }).join("") + '<span class="ds-alti-mark"><span></span></span>';
  var altiMark = alti.lastChild;

  // ------------------------------------------------------------- data --
  function elev(x, y) {
    var g = meta.grid;
    var fx = Math.min(Math.max(x / g.cell_m[0] - 0.5, 0), g.cols - 1.001);
    var fy = Math.min(Math.max(y / g.cell_m[1] - 0.5, 0), g.rows - 1.001);
    var c = Math.floor(fx), r = Math.floor(fy), tx = fx - c, ty = fy - r, i = r * g.cols + c;
    var a = dem[i] + (dem[i + 1] - dem[i]) * tx;
    var b = dem[i + g.cols] + (dem[i + g.cols + 1] - dem[i + g.cols]) * tx;
    return a + (b - a) * ty;
  }
  function sceneZ(x, y) { return (elev(x, y) - H0) * ex; }
  // Reference ground for the camera height: the highest point in the next 6 km,
  // precomputed along the route and smoothed (~1 km), so a hilltop entering the
  // look-ahead window lifts the camera gently instead of making it jump.
  var GS_STEP = 20, GS0 = -1000, groundProfile = null;
  function buildGround() {
    var n = Math.ceil((ROUTE_LEN + 8000 - GS0) / GS_STEP), raw = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var s = GS0 + i * GS_STEP, hi = 0;
      for (var d = 0; d <= 6000; d += 50) hi = Math.max(hi, elev(OX + UX * (s + d), OY + UY * (s + d)));
      raw[i] = hi;
    }
    var out = new Float32Array(n), R = 25;            // +-500 m box filter, twice (~ Gaussian)
    for (var pass = 0, src = raw; pass < 2; pass++, src = out.slice()) {
      for (var j = 0; j < n; j++) {
        var sum = 0, cnt = 0;
        for (var k = Math.max(0, j - R); k <= Math.min(n - 1, j + R); k++) { sum += src[k]; cnt++; }
        out[j] = sum / cnt;
      }
    }
    groundProfile = out;
  }
  function ground(s) {
    var f = Math.min(Math.max((s - GS0) / GS_STEP, 0), groundProfile.length - 1.001), i = Math.floor(f);
    var h = groundProfile[i] + (groundProfile[i + 1] - groundProfile[i]) * (f - i);
    return (h - H0) * ex;
  }
  function loadEarth() {
    if (earthLoading) return;
    earthLoading = true;
    fetch(base + "earth.json")
      .then(function (r) { return r.json(); })
      .then(function (d) { earth = d; if (cur) draw(cur); })
      .catch(function () {});
    // map features for the aerial survey (tools/orbit/build_aerial.py, OpenStreetMap): per layer, each line
    // or outline with absolute x, y and the ground elevation per vertex (once), and its route-coordinate
    // bounding box for culling
    fetch(base + "aerial-features.json")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        feats = {};
        Object.keys(d.layers).forEach(function (k) {
          feats[k] = d.layers[k].map(function (f) {
            var n = f.length / 2, xy = new Float64Array(n * 3), x = 0, y = 0, b = [1e9, -1e9, 1e9, -1e9];
            for (var i = 0; i < n; i++) {
              x += f[2 * i]; y += f[2 * i + 1];
              xy[3 * i] = x; xy[3 * i + 1] = y; xy[3 * i + 2] = elev(x, y);
              var a = (x - OX) * UX + (y - OY) * UY, l = (x - OX) * RX + (y - OY) * RY;
              b = [Math.min(b[0], a), Math.max(b[1], a), Math.min(b[2], l), Math.max(b[3], l)];
            }
            return { p: xy, b: b };
          });
        });
        if (cur) draw(cur);
      })
      .catch(function () {});
  }

  // ---------------------------------------------------------- helpers --
  var colors = {};
  function readColors() {
    var cs = getComputedStyle(root);
    ["--paper", "--contour", "--ink", "--accent-mark", "--water", "--muted"].forEach(function (n) { colors[n] = cs.getPropertyValue(n).trim(); });
  }
  function color(name) { return colors[name]; }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function clamp(v, a, b) { return Math.min(Math.max(v, a), b); }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    layoutKeys();
  }
  // where the viewport centre is inside section [02]: 0 at its top, 1 at its bottom
  function orbitT() {
    if (!orbit) return -1;
    var r = orbit.getBoundingClientRect();
    return (h * 0.5 - r.top) / r.height;
  }
  function orbitShare() {
    if (!orbit) return 0;
    var r = orbit.getBoundingClientRect();
    return Math.max(0, Math.min(r.bottom, h) - Math.max(r.top, 0)) / h;
  }

  // Keyframes of the descent, placed on the chapters: [t, height, pitch°, screen x, screen y,
  // heading°, relief factor]. The zoom into Freiburg is tilted (~60°) so the joy plot shows the
  // mountains, with relief close to real (0.58 x EX = 1.5x); the factor eases back to 1 by drone height. The camera holds each platform's height while its chapter is centred; in orbit
  // it faces north (so Europe reads the right way up) and turns back to the route on the way down.
  function layoutKeys() {
    if (!orbit || chapters.length < 3 || reduce.matches) return;
    var r = orbit.getBoundingClientRect();
    var c = chapters.map(function (ch) {
      var q = ch.getBoundingClientRect();
      return (q.top + q.height / 2 - r.top) / r.height;
    });
    var g1 = c[1] - c[0], g2 = c[2] - c[1], g3 = 1 - c[2];
    var k = [
      [0, CRUISE, 0, 0.5, 0.26, ROUTE_BRG, 1],
      [Math.max(0.04, c[0] - 0.35 * g1), ORBIT_H, -58, 0.66, 0.62, 0, 1],
      [c[0] + 0.15 * g1, ORBIT_H, -62, 0.66, 0.62, 0, 0.6],
      [c[0] + 0.55 * g1, 30000, -60, 0.66, 0.58, ROUTE_BRG, 0.58],
      [c[1] - 0.35 * g1, 6000, -62, 0.66, 0.56, ROUTE_BRG, 0.58],
      [c[1] - 0.12 * g1, AERIAL_H, -89, 0.66, 0.5, ROUTE_BRG, 0.7],
      [c[1] + 0.2 * g2, AERIAL_H, -89, 0.66, 0.5, ROUTE_BRG, 0.7],
      [c[2] - 0.1 * g2, DRONE_H, -28, 0.66, 0.42, ROUTE_BRG, 1],
      [c[2] + 0.3 * g3, DRONE_H, -24, 0.66, 0.42, ROUTE_BRG, 1],
      [1, CRUISE, 0, 0.5, 0.26, ROUTE_BRG, 1],
    ];
    for (var i = 1; i < k.length; i++) k[i][0] = Math.max(k[i][0], k[i - 1][0] + 0.005);
    keys = k;
    zones = [(c[0] + c[1]) / 2, (c[1] + c[2]) / 2];
    // The survey is flown from arriving at 1 km until the tilt towards the drone view (surveyT, in t).
    // Meanwhile the camera hovers over the survey at SURVEY_AT (hold, in page fractions); the flight before
    // and after is stretched a little to fit, so the block and the aircraft stay in view.
    surveyT = [k[5][0] - 0.4 * (k[5][0] - k[4][0]), k[6][0] + 0.35 * (k[7][0] - k[6][0])];
    var max = document.documentElement.scrollHeight - h, top = window.scrollY + r.top;
    hold = surveyT.map(function (tt) { return clamp((top - h / 2 + tt * r.height) / (max || 1), 0.001, 0.999); });
    surveyS = SURVEY_AT;
  }

  // camera target from the scroll position: s along the route, log height,
  // pitch (rad), screen centre (fractions)
  function target() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var p = reduce.matches ? 0.35 : clamp(window.scrollY / (max || 1), 0, 1);
    if (hold && !reduce.matches) {                 // hover over the aerial survey (see layoutKeys)
      var sf = SURVEY_AT / (ROUTE_LEN - END_GAP);
      p = p < hold[0] ? (p / hold[0]) * sf : p < hold[1] ? sf : sf + ((p - hold[1]) / (1 - hold[1])) * (1 - sf);
    }
    var cam = { s: p * (ROUTE_LEN - END_GAP), la: Math.log(CRUISE), pitch: 0, cx: 0.5, cy: 0.26, yaw: ROUTE_BRG, boost: 1, zoom: 1, fin: 0 };
    // arriving at the Feldberg (contact): on wide screens the summit moves right
    // of centre, beside the text block on the left
    // and the camera tilts down (ARRIVE_PITCH) and climbs a little, looking onto the summit
    if (contact) {
      var cr = contact.getBoundingClientRect();
      var seen = Math.max(0, Math.min(cr.bottom, h) - Math.max(cr.top, 0)) / h;
      var ka = reduce.matches ? 0 : smooth(clamp(seen * 1.3, 0, 1));
      if (w >= 900) cam.cx = 0.5 + 0.17 * ka;
      cam.pitch = (-ARRIVE_PITCH * Math.PI / 180) * ka;
      cam.la = Math.log(CRUISE + ARRIVE_CLIMB * ka);
      cam.cy = w < 900 ? 0.26 - 0.09 * ka : 0.26 + 0.1 * ka; // summit in the upper third (centred layouts: above the contact rows)
      cam.zoom = 1 + (ARRIVE_ZOOM - 1) * ka;
      cam.boost = 1 + (ARRIVE_RELIEF - 1) * ka;   // relief closer to real for the digital twin (finale.js)
      // finale progress: from Contact's top at 10 % of the screen (the plates are gone) to the page end
      var endTop = cr.top - (max - window.scrollY), f0 = h * 0.1, f1 = Math.min(f0 - 80, endTop + h * 0.02);
      var kf = reduce.matches ? 0 : smooth(clamp((f0 - cr.top) / (f0 - f1), 0, 1));
      cam.fin = kf;
      var wide = w >= 900;                          // centred layouts: only a small step, the rows sit below
      cam.s += FIN_FORWARD * kf * (wide ? 1 : 0.25);
      cam.la = Math.log(CRUISE + ARRIVE_CLIMB * ka + FIN_CLIMB * kf * (wide ? 1 : 0.25));
      if (wide) cam.zoom *= 1 + (FIN_ZOOM - 1) * kf;
      cam.cy -= (wide ? FIN_LIFT : -0.035) * kf;    // wide: the summit moves up, clear of the footer; else its label clears the nav
    }
    var t = orbitT();
    if (keys && !reduce.matches && t > 0 && t < 1) {
      var i = 1;
      while (i < keys.length - 1 && keys[i][0] < t) i++;
      var a = keys[i - 1], b = keys[i], k = smooth(clamp((t - a[0]) / (b[0] - a[0]), 0, 1));
      cam.la = Math.log(a[1]) + (Math.log(b[1]) - Math.log(a[1])) * k;
      cam.pitch = ((a[2] + (b[2] - a[2]) * k) * Math.PI) / 180;
      cam.cx = w < 720 ? 0.5 : a[3] + (b[3] - a[3]) * k;
      // phones: the chapter text sits mid-screen, so the scene's centre moves below it
      var cyA = w < 720 && a[2] ? 0.76 : a[4], cyB = w < 720 && b[2] ? 0.76 : b[4];
      cam.cy = cyA + (cyB - cyA) * k;
      cam.yaw = a[5] + (b[5] - a[5]) * k;
      cam.boost = a[6] + (b[6] - a[6]) * k;
    }
    return cam;
  }

  // ------------------------------------------------------------- draw --
  // Adaptive quality: while moving, a slow machine draws fewer samples and lines
  // (q 1 ... 2.5) so frames stay smooth; when the camera rests, one sharp frame.
  var q = 1, qMoving = 1, drawMs = 0;
  function draw(cam) {
    var t0 = performance.now();
    drawScene(cam);
    var ms = performance.now() - t0;
    drawMs = drawMs ? drawMs * 0.8 + ms * 0.2 : ms;
  }
  function drawScene(cam) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ex = EX * cam.boost;
    var alt = Math.exp(cam.la), pitchDeg = (-cam.pitch * 180) / Math.PI;
    var G = ground(cam.s);
    var CX = OX + UX * cam.s, CY = OY + UY * cam.s, CZ = G + alt;
    var cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    var hx = Math.sin((cam.yaw * Math.PI) / 180), hy = -Math.cos((cam.yaw * Math.PI) / 180), rx = -hy, ry = hx;
    var F = Math.max(w, h) * 0.42 * cam.zoom, PX = w * cam.cx, PY = h * cam.cy;
    var out = [0, 0, 0];
    function proj(X, Y, Z) {
      var dx = X - CX, dy = Y - CY, dz = Z - CZ;
      var fh = dx * hx + dy * hy, rt = dx * rx + dy * ry;
      var zc = fh * cp + dz * sp, yc = -fh * sp + dz * cp;
      if (zc < 1) return false;
      out[0] = PX + (F * rt) / zc;
      out[1] = PY - (F * yc) / zc;
      out[2] = zc;
      return true;
    }
    var view = { alt: alt, CX: CX, CY: CY, CZ: CZ, proj: proj, out: out,
      pitch: cam.pitch, key: [cam.pitch * 2000, cam.yaw * 20, F, PX, PY].map(Math.round).join("/") };
    var paper = color("--paper"), line = color("--contour"), ink = color("--ink");
    var t = orbitT();
    var inOrbit = !!keys && t > 0 && t < 1;
    var live = inOrbit && cam.pitch < -0.02;

    // --- the Earth from orbit (above ~25 km), country outlines down to ~60 km
    var orbA = clamp((alt - 25000) / 75000, 0, 1);
    var mapA = clamp((alt - 60000) / 80000, 0, 1); // outlines are not draped: gone before the terrain rises
    if (orbA > 0) drawGlobe(orbA, view, line);
    if (mapA > 0 && earth) drawEarth(mapA, view, ink);
    if (alt > 60000) {
      // the pass runs from arriving in orbit until the zoom into Freiburg is under way
      var p0 = keys ? keys[1][0] : 0, p1 = keys ? keys[2][0] : 1;   // over Freiburg as the zoom begins
      var satD = PASS_FROM * (1 - clamp((t - p0) / (p1 - p0), 0, 1));
      drawSwath(clamp((alt - 60000) / 140000, 0, 1), view, ink, line, satD);
    }

    // --- terrain: cross-section lines at fixed distances along the route
    var terrA = clamp((90000 - alt) / 60000, 0, 1);
    var drawn = [];
    var linesA = 1 - FIN_LINES * smooth(clamp(((cam.fin || 0) - 0.4) / 0.5, 0, 1));   // the old map gives way
    if (terrA > 0) {
      // line spacing: in level flight it grows with height; looking down (the
      // descent) it follows the screen, a line every ~6.5 px, so the joy plot
      // stays dense at any height. Steps halve/double, so lines stay put.
      var down = pitchDeg > 45;
      var Hg = Math.max(CZ - sceneZ(CX, CY), 50);
      var lvl = down ? clamp(Math.log2((6.5 * Hg) / F / STEP), -2, 6) : clamp(Math.log2(alt / CRUISE), -2, 6);
      var n0 = Math.floor(lvl), frac = lvl - n0;
      var step = STEP * Math.pow(2, n0);
      var gapPx = (step * F) / Hg;
      // ground distances covered by the view (bottom and top screen edges)
      var aBot = -cam.pitch + Math.atan((h - PY) / F), aTop = -cam.pitch - Math.atan(PY / F);
      var H = Math.max(CZ, 1);
      var aMin = aBot >= Math.PI / 2 - 1e-3 ? -H * Math.tan(aBot - Math.PI / 2) : H / Math.tan(aBot);
      var aMax = aTop <= 0.02 ? FAR : Math.min(Math.max(FAR, alt * 3), H / Math.tan(aTop));
      aMin = cam.s + aMin - 2 * step;
      aMax = cam.s + aMax + 2 * step;
      while ((aMax - aMin) / step > (down ? 640 : 160)) { step *= 2; n0++; frac = 0; }
      var g = meta.grid, W = g.cols * g.cell_m[0], Hm = g.rows * g.cell_m[1];
      var fogFar = Math.max(FAR, alt * 4);
      ctx.lineJoin = "round";
      ctx.strokeStyle = line;
      ctx.fillStyle = paper;
      for (var k = Math.floor(aMax / step); k * step >= aMin; k--) {
        var a = k * step;
        var px = OX + UX * a, py = OY + UY * a;
        // lateral extent inside the DEM (slab clip)
        var lo = -1e9, hi = 1e9;
        [[px, RX, W], [py, RY, Hm]].forEach(function (q) {
          if (Math.abs(q[1]) < 1e-9) { if (q[0] < 0 || q[0] > q[2]) { lo = 1; hi = 0; } return; }
          var t1 = (0 - q[0]) / q[1], t2 = (q[2] - q[0]) / q[1];
          lo = Math.max(lo, Math.min(t1, t2));
          hi = Math.min(hi, Math.max(t1, t2));
        });
        if (hi - lo < 200) continue;
        var dist = Math.hypot(px - CX, py - CY, sceneZ(px, py) - CZ);
        var span = ((w / 2) / F) * dist * 1.6 + 600;
        lo = Math.max(lo, -span);
        hi = Math.min(hi, span);
        if (hi <= lo) continue;
        var near = clamp(1 - (dist - H * 0.9) / fogFar, 0, 1);
        var thin = n0 <= 0 && k % 2 ? clamp((7000 - (a - cam.s)) / 2000, 0, 1) : 1;
        if (k % 2) thin *= 1 - frac;
        var alpha = (0.25 + 0.75 * Math.pow(near, 1.3)) * thin * terrA * linesA;
        if (alpha < 0.03) continue;
        var dl = Math.max(25, ((down ? 5 : 3.5) * q * dist) / F);
        dl = 25 * Math.pow(2, Math.round(Math.log2(dl / 25)));
        // the ridge line, and below it its base at sea level: the "curtain"
        // between them hides what lies behind (works level and looking down)
        var fill = cam.pitch > -1.2; // looking (almost) straight down nothing hides anything
        var pts = [], basePts = [], top = Infinity;
        for (var l = Math.ceil(lo / dl) * dl; l <= hi; l += dl) {
          var X = px + RX * l, Y = py + RY * l;
          if (!proj(X, Y, sceneZ(X, Y))) continue;
          var sx = out[0], sy = out[1];
          pts.push(sx, sy);
          if (fill) {
            if (proj(X, Y, -H0 * ex)) basePts.push(out[0], Math.max(out[1], sy));
            else basePts.push(sx, h + 4);
          }
          if (sy < top) top = sy;
        }
        if (pts.length < 4 || top > h + 2) continue;
        var minX = Infinity, maxX = -Infinity;
        for (var j = 0; j < pts.length; j += 2) { minX = Math.min(minX, pts[j]); maxX = Math.max(maxX, pts[j]); }
        if (maxX < 0 || minX > w) continue;
        drawn.push([a - cam.s, pts]);
        if (fill) {
          ctx.beginPath();
          ctx.moveTo(pts[0], pts[1]);
          for (j = 2; j < pts.length; j += 2) ctx.lineTo(pts[j], pts[j + 1]);
          for (j = basePts.length - 2; j >= 0; j -= 2) ctx.lineTo(basePts[j], basePts[j + 1]);
          ctx.closePath();
          ctx.globalAlpha = 1;
          ctx.fill();
        }
        ctx.beginPath(); // stroke the ridge only, not the curtain's edges
        ctx.moveTo(pts[0], pts[1]);
        for (j = 2; j < pts.length; j += 2) ctx.lineTo(pts[j], pts[j + 1]);
        ctx.globalAlpha = alpha;
        ctx.lineWidth = down ? Math.min(0.6 + 1.1 * near * near, 0.35 + gapPx * 0.12) : 0.6 + 1.1 * near * near;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // --- what each platform covers: aerial survey frames, then a drone corridor
    if (live) {
      // the whole survey fades out over the first degrees of the tilt to the drone view, with its map (featA)
      var aerialA = clamp((6000 - alt) / 3000, 0, 1) * clamp((pitchDeg - 80) / 7, 0, 1);
      if (aerialA > 0.02) drawSurvey(aerialA, clamp((t - surveyT[0]) / (surveyT[1] - surveyT[0]), 0, 1), view, ink);
      var droneA = clamp((pitchDeg - 8) / 12, 0, 1) * clamp((50 - pitchDeg) / 10, 0, 1) * clamp((700 - alt) / 400, 0, 1);
      if (droneA > 0.02) drawViewfinder(droneA, PX, PY, ink);
    }

    // --- summits ahead (flight and the arrival view): a tick and the name, like a map label
    if (cam.pitch > -1.0 && alt < 5000 && !window.flightFinaleOn) { // incl. the view onto the Feldberg; the finale labels its own
      setLabelFont(1.5);
      ctx.textAlign = "center";
      ctx.fillStyle = ink;
      (meta.places || []).forEach(function (pl) {
        if (pl.kind !== "summit") return;
        var d = (pl.x - CX) * UX + (pl.y - CY) * UY;
        if (d < 1500 || d > 9000 || !proj(pl.x, pl.y, (pl.elev - H0) * ex)) return;
        var sx = out[0], sy = out[1];
        if (sx < 40 || sx > w - 40 || sy < 20 || sy > h) return;
        if (hiddenBehind(drawn, d, sx, sy)) return;
        ctx.globalAlpha = clamp((9000 - d) / 2500, 0, 1) * 0.9;
        ctx.fillRect(sx - 0.5, sy - 14, 1, 9);
        ctx.fillText((de ? pl.de : pl.en).toUpperCase() + "  " + pl.elev + " m", sx, sy - 20);
      });
      ctx.globalAlpha = 1;
    }

    // --- Freiburg marked while looking down from high up (accent: "you are here"); not at the aerial stop
    // (owner, 2026-10-13: the survey should not be about Freiburg)
    if (live && pitchDeg > 40 && alt >= 8000 && proj(FREIBURG[0], FREIBURG[1], sceneZ(FREIBURG[0], FREIBURG[1]))) {
      var mx = out[0], my = out[1];
      ctx.globalAlpha = clamp((pitchDeg - 40) / 15, 0, 1);
      // the site's location marker (as in the hero and the altimeter): an outlined diamond with a solid core
      ctx.strokeStyle = ctx.fillStyle = color("--accent-mark");
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(mx, my - 7); ctx.lineTo(mx + 7, my); ctx.lineTo(mx, my + 7); ctx.lineTo(mx - 7, my); ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(mx, my - 3.5); ctx.lineTo(mx + 3.5, my); ctx.lineTo(mx, my + 3.5); ctx.lineTo(mx - 3.5, my); ctx.closePath();
      ctx.fill();
      setLabelFont(2);
      ctx.textAlign = "left";
      ctx.fillStyle = ink;
      ctx.fillText("FREIBURG", mx + 13, my + 3.5);
      ctx.globalAlpha = 1;
    }

    // --- the finale (finale.js): the Feldberg as a 3D digital twin, drawn with this camera
    if (window.flightFinale) {
      window.flightFinale({ CX: CX, CY: CY, CZ: CZ, hx: hx, hy: hy, rx: rx, ry: ry, cp: cp, sp: sp, F: F, PX: PX, PY: PY,
        w: w, h: h, dpr: dpr, ex: ex, H0: H0, k: cam.fin || 0 });
    }

    // --- page state: section emphasis, altimeter, opacity, readout
    root.classList.toggle("orbit-live", inOrbit && !reduce.matches);
    if (inOrbit) {
      var zone = t < zones[0] ? 0 : t < zones[1] ? 1 : 2;
      chapters.forEach(function (c, i) { c.classList.toggle("is-active", i === zone); });
      alti.querySelectorAll(".is-platform").forEach(function (el) {
        el.classList.toggle("is-active", Number(el.dataset.i) === zone);
      });
      var top = clamp(altiY(alt), 0, 100).toFixed(1) + "%";
      if (altiMark.style.top !== top) altiMark.style.top = top;
      altiMark.firstChild.textContent = fmtHeight(alt);
    }
    var share = orbitShare();
    var fade = String(keys ? 1 : Math.round((1 - 0.85 * share) * 100) / 100);
    if (fade !== lastFade) { canvas.style.setProperty("--fade", fade); lastFade = fade; }
    if (share > 0 && !earth) loadEarth();
    var ll = lonLat(CX, CY), realAlt = alt + G / ex + H0;
    var cr = contact && contact.getBoundingClientRect();
    var arrived = !!cr && cr.top < h * 0.6 && cr.bottom > h * 0.3;
    root.classList.toggle("arrive-live", arrived && !reduce.matches);
    hud.children[0].textContent = arrived ? T.arrived : T.title;
    hud.children[1].textContent = T.route;
    hud.children[2].textContent = num(ll[1], 3) + "°N " + num(ll[0], 3) + "°" + T.E + " · " + T.alt + " " + fmtHeight(realAlt);
    var heroGone = !hero || hero.getBoundingClientRect().bottom < h * 0.5;
    var footerIn = footer && footer.getBoundingClientRect().top < h - 90;
    hud.classList.toggle("is-on", heroGone && share < 0.3 && !footerIn);
  }

  function setLabelFont(spacing) {
    ctx.font = '500 10px "IBM Plex Mono", monospace';
    if ("letterSpacing" in ctx) ctx.letterSpacing = spacing + "px";
  }
  function fmtHeight(m) {
    return m >= 10000 ? Math.round(m / 1000).toLocaleString(root.lang) + " km"
      : m >= 1000 ? (Math.round(m / 100) / 10).toLocaleString(root.lang) + " km"
      : Math.round(m).toLocaleString(root.lang) + " m";
  }

  // a nearer ridge rises above the point (sx, sy)?
  function hiddenBehind(drawn, d, sx, sy) {
    for (var j = 0; j < drawn.length; j++) {
      if (drawn[j][0] >= d - 400) continue;
      var p = drawn[j][1];
      for (var i = 2; i < p.length; i += 2) {
        if ((p[i - 2] - sx) * (p[i] - sx) <= 0) {
          var t = (sx - p[i - 2]) / (p[i] - p[i - 2] || 1);
          if (p[i - 1] + (p[i + 1] - p[i - 1]) * t < sy - 2) return true;
          break;
        }
      }
    }
    return false;
  }

  // ---------------------------------------------------------- the globe --
  var RAD = Math.PI / 180;
  var LAT0 = CENTER_LL[0] * RAD, LON0 = CENTER_LL[1] * RAD;
  // scene coordinates of a lat/lon on the sphere (local frame at the region centre)
  function onSphere(latd, lond) {
    var la = latd * RAD, lo = lond * RAD - LON0;
    var e = R_EARTH * Math.cos(la) * Math.sin(lo);
    var n = R_EARTH * (Math.sin(la) * Math.cos(LAT0) - Math.cos(la) * Math.sin(LAT0) * Math.cos(lo));
    var u = R_EARTH * (Math.sin(la) * Math.sin(LAT0) + Math.cos(la) * Math.cos(LAT0) * Math.cos(lo)) - R_EARTH;
    return [CENTER_XY[0] + e, CENTER_XY[1] - n, u];
  }
  // the point faces the camera: (P - camera) . outward normal < 0
  function facing(P, v) {
    var nx = (P[0] - CENTER_XY[0]) / R_EARTH, ny = (P[1] - CENTER_XY[1]) / R_EARTH, nz = (P[2] + R_EARTH) / R_EARTH;
    return (P[0] - v.CX) * nx + (P[1] - v.CY) * ny + (P[2] - v.alt) * nz < 0;
  }
  // Static lines on the sphere are converted to scene points once ([x, y, z, ...]).
  var sphereCache = typeof WeakMap === "function" ? new WeakMap() : null;
  function toScene(flat) {
    var hit = sphereCache && sphereCache.get(flat);
    if (hit) return hit;
    var out = new Float64Array((flat.length / 2) * 3);
    for (var i = 0, j = 0; i < flat.length; i += 2, j += 3) {
      var P = onSphere(flat[i + 1], flat[i]);
      out[j] = P[0]; out[j + 1] = P[1]; out[j + 2] = P[2];
    }
    if (sphereCache) sphereCache.set(flat, out);
    return out;
  }
  // the point (x, y, z) faces the camera
  function facingXYZ(x, y, z, v) {
    return (x - v.CX) * (x - CENTER_XY[0]) + (y - v.CY) * (y - CENTER_XY[1]) + (z - v.alt) * (z + R_EARTH) < 0;
  }
  // stroke a lat/lon path ([lon, lat, lon, lat, ...]), skipping hidden parts
  function strokeLonLat(flat, v) {
    var P3 = toScene(flat);
    ctx.beginPath();
    var pen = false;
    for (var i = 0; i < P3.length; i += 3) {
      if (facingXYZ(P3[i], P3[i + 1], P3[i + 2], v) && v.proj(P3[i], P3[i + 1], P3[i + 2])) {
        if (pen) ctx.lineTo(v.out[0], v.out[1]);
        else ctx.moveTo(v.out[0], v.out[1]);
        pen = true;
      } else pen = false;
    }
    ctx.stroke();
  }
  var gratLines = null;
  function graticule() {
    if (!gratLines) {
      gratLines = [];
      var lat, lon, path, x;
      for (lat = 20; lat <= 75; lat += 5) {
        for (path = [], x = -40; x <= 55; x += 0.5) path.push(x, lat);
        gratLines.push(path);
      }
      for (lon = -40; lon <= 55; lon += 5) {
        for (path = [], x = 20; x <= 76; x += 0.5) path.push(lon, x);
        gratLines.push(path);
      }
    }
    return gratLines;
  }
  function drawGlobe(a, v, line) {
    ctx.strokeStyle = line;
    ctx.lineJoin = "round";
    ctx.lineWidth = 0.8;
    ctx.globalAlpha = a * 0.45;
    graticule().forEach(function (path) { strokeLonLat(path, v); });
    // limb: the circle where the view grazes the sphere, around the point below the camera
    var phi = Math.acos(R_EARTH / (R_EARTH + v.alt)), rho = R_EARTH * Math.sin(phi), drop = R_EARTH * (1 - Math.cos(phi));
    ctx.globalAlpha = a;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    var pen = false;
    for (var az = 0; az <= 360; az += 2) {
      var r = az * RAD;
      if (v.proj(v.CX + rho * Math.cos(r), v.CY + rho * Math.sin(r), -drop)) {
        if (pen) ctx.lineTo(v.out[0], v.out[1]);
        else ctx.moveTo(v.out[0], v.out[1]);
        pen = true;
      } else pen = false;
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // country outlines: coastlines and land borders, both solid
  function drawEarth(a, v, ink) {
    ctx.lineJoin = "round";
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5 * a;
    earth.borders.forEach(function (p) { strokeLonLat(p, v); });
    earth.coast.forEach(function (p) { strokeLonLat(p, v); });
    ctx.globalAlpha = 1;
  }
  // great-circle destination from lat/lon (deg), bearing (deg), distance (m)
  function dest(lat, lon, brg, d) {
    var p1 = lat * RAD, l1 = lon * RAD, th = brg * RAD, dl = d / R_EARTH;
    var p2 = Math.asin(Math.sin(p1) * Math.cos(dl) + Math.cos(p1) * Math.sin(dl) * Math.cos(th));
    var l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(dl) * Math.cos(p1), Math.cos(dl) - Math.sin(p1) * Math.sin(p2));
    return [p2 / RAD, l2 / RAD];
  }
  function bearing(a, b) {
    var p1 = a[0] * RAD, p2 = b[0] * RAD, dl = (b[1] - a[1]) * RAD;
    return Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / RAD;
  }
  // A swath (half-width in m) along the ground track through Freiburg: edges and track as lon/lat paths,
  // index i at d = -3000 km + i * 50 km (north positive). Cached per width.
  var swaths = {};
  function swathLines(half) {
    if (!swaths[half]) {
      var f = lonLat(FREIBURG[0], FREIBURG[1]), left = [], right = [], track = [];
      for (var d = -3000e3; d <= 3000e3; d += 50e3) {
        var e = trackAt(f, d, half);
        left.push(e.L[1], e.L[0]);
        right.push(e.R[1], e.R[0]);
        track.push(e.P[1], e.P[0]);
      }
      swaths[half] = { left: left, right: right, track: track };
    }
    return swaths[half];
  }
  // point d (m, north positive) along the track through f, and the swath edges there
  function trackAt(f, d, half) {
    var P = d < 0 ? dest(f[1], f[0], S2_TRACK + 180, -d) : dest(f[1], f[0], S2_TRACK, d);
    var N = d + 1e3 < 0 ? dest(f[1], f[0], S2_TRACK + 180, -(d + 1e3)) : dest(f[1], f[0], S2_TRACK, d + 1e3);
    var b = bearing(P, N);
    return { P: P, L: dest(P[0], P[1], b - 90, half), R: dest(P[0], P[1], b + 90, half) };
  }
  // screen point of a lat/lon on the visible side of the globe, or null
  function seen(ll, v) {
    var S = onSphere(ll[0], ll[1]);
    return facing(S, v) && v.proj(S[0], S[1], S[2]) ? [v.out[0], v.out[1]] : null;
  }
  // stroke the part of a swath path from index i0 on (north of the scan line), starting at point `from`
  function strokeFrom(flat, v, i0, from) {
    var P3 = toScene(flat);
    ctx.beginPath();
    var pen = false;
    if (from) { ctx.moveTo(from[0], from[1]); pen = true; }
    for (var i = i0 * 3; i < P3.length; i += 3) {
      if (facingXYZ(P3[i], P3[i + 1], P3[i + 2], v) && v.proj(P3[i], P3[i + 1], P3[i + 2])) {
        if (pen) ctx.lineTo(v.out[0], v.out[1]);
        else ctx.moveTo(v.out[0], v.out[1]);
        pen = true;
      } else pen = false;
    }
    ctx.stroke();
  }
  // The satellite pass: Sentinel-2's swath filling in north of the scan line at satD, the scan line itself
  // and the satellite (a map symbol over its ground point).
  function drawSwath(a, v, ink, line, satD) {
    var f = lonLat(FREIBURG[0], FREIBURG[1]);
    ctx.strokeStyle = ink;
    ctx.lineJoin = "round";
    var sw = swathLines(S2_HALF), i0 = Math.ceil((satD + 3000e3) / 50e3);
    var e = trackAt(f, satD, S2_HALF), sL = seen(e.L, v), sR = seen(e.R, v), sP = seen(e.P, v);
    // imaged part: fill between the edges from the scan line northwards
    function collect(flat) {
      var pts = [], P3 = toScene(flat);
      for (var i = i0 * 3; i < P3.length; i += 3) {
        if (facingXYZ(P3[i], P3[i + 1], P3[i + 2], v) && v.proj(P3[i], P3[i + 1], P3[i + 2])) pts.push([v.out[0], v.out[1]]);
      }
      return pts;
    }
    var poly = (sL ? [sL] : []).concat(collect(sw.left), collect(sw.right).reverse(), sR ? [sR] : []);
    if (poly.length > 3) {
      ctx.beginPath();
      poly.forEach(function (q, i) { if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
      ctx.closePath();
      ctx.fillStyle = line;
      ctx.globalAlpha = 0.14 * a;
      ctx.fill();
    }
    // the planned swath ahead faintly, the imaged part solid
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.22 * a;
    strokeLonLat(sw.left, v);
    strokeLonLat(sw.right, v);
    ctx.globalAlpha = 0.75 * a;
    strokeFrom(sw.left, v, i0, sL);
    strokeFrom(sw.right, v, i0, sR);
    ctx.setLineDash([2, 5]);
    ctx.globalAlpha = 0.45 * a;
    strokeLonLat(sw.track, v);
    ctx.setLineDash([]);
    // scan line and satellite
    if (sL && sR) {
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = 0.9 * a;
      ctx.beginPath(); ctx.moveTo(sL[0], sL[1]); ctx.lineTo(sR[0], sR[1]); ctx.stroke();
    }
    var ahead = seen(trackAt(f, satD - 60e3, S2_HALF).P, v);
    if (sP && ahead) drawSatellite(sP[0], sP[1], Math.atan2(ahead[1] - sP[1], ahead[0] - sP[0]), a, ink);
    // label along the eastern edge, north of Freiburg
    var i = 2 * (60 + 16), S = onSphere(sw.right[i + 1], sw.right[i]);
    if (facing(S, v) && v.proj(S[0], S[1], S[2]) && v.out[1] > 20) label(T.swath, v.out[0] + 10, v.out[1], a);
    ctx.globalAlpha = 1;
  }
  // a small satellite: body and two solar panels across the flight direction (rad, screen)
  function drawSatellite(x, y, dir, a, ink) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(dir);
    ctx.scale(1.5, 1.5);
    ctx.globalAlpha = a;
    ctx.fillStyle = color("--paper");
    ctx.strokeStyle = ink;
    ctx.lineWidth = 0.9;
    [[-3.5, -3.5, 7, 7], [-2.5, -17, 5, 10], [-2.5, 7, 5, 10]].forEach(function (r) {
      ctx.fillRect(r[0], r[1], r[2], r[3]);
      ctx.strokeRect(r[0], r[1], r[2], r[3]);
    });
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(0, -3.5); ctx.moveTo(0, 3.5); ctx.lineTo(0, 7);
    ctx.moveTo(-2.5, -12); ctx.lineTo(2.5, -12); ctx.moveTo(-2.5, 12); ctx.lineTo(2.5, 12);
    ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------ platform footprints --
  function strokeDraped(xy, v) {
    ctx.beginPath();
    var pen = false;
    for (var i = 0; i < xy.length; i += 2) {
      if (v.proj(xy[i], xy[i + 1], sceneZ(xy[i], xy[i + 1]))) {
        if (pen) ctx.lineTo(v.out[0], v.out[1]);
        else ctx.moveTo(v.out[0], v.out[1]);
        pen = true;
      } else pen = false;
    }
    ctx.stroke();
  }
  function rectPath(x0, y0, x1, y1, step) {
    var p = [], s;
    for (s = x0; s < x1; s += step) p.push(s, y0);
    for (s = y0; s < y1; s += step) p.push(x1, s);
    for (s = x1; s > x0; s -= step) p.push(s, y1);
    for (s = y1; s >= y0; s -= step) p.push(x0, s);
    p.push(x0, y0);
    return p;
  }
  // a rectangle in route coordinates (along a, lateral l), as world x/y points
  function routeRect(a0, l0, a1, l1, step) {
    var p = [], q = [], s;
    for (s = a0; s < a1; s += step) q.push([s, l0]);
    for (s = l0; s < l1; s += step) q.push([a1, s]);
    for (s = a1; s > a0; s -= step) q.push([s, l1]);
    for (s = l1; s >= l0; s -= step) q.push([a0, s]);
    q.push([a0, l0]);
    q.forEach(function (r) { p.push(OX + UX * r[0] + RX * r[1], OY + UY * r[0] + RY * r[1]); });
    return p;
  }
  // Footprints of one platform: strips of overlapping image frames along the
  // flight direction, fixed in the landscape; the frame nearest to `here`
  // (route position) is drawn solid and labelled.
  function drawFootprints(o, v, ink) {
    var best = null;
    ctx.strokeStyle = ink;
    ctx.lineJoin = "miter";
    ctx.lineWidth = 0.75;
    ctx.globalAlpha = 0.35 * o.a;
    for (var k = -o.strips; k <= o.strips; k++) {
      var l0 = k * o.dl - o.fl / 2, off = k % 2 ? o.da / 2 : 0;
      for (var j = Math.floor((o.from - off) / o.da); j * o.da + off <= o.to; j++) {
        var a0 = j * o.da + off;
        var dc = Math.abs(a0 - o.here) + Math.abs(k) * 1e6;
        if (!best || dc < best[2]) best = [a0, l0, dc];
        strokeDraped(routeRect(a0, l0, a0 + o.fa, l0 + o.fl, o.step), v);
      }
    }
    if (!best) return;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.9 * o.a;
    strokeDraped(routeRect(best[0], best[1], best[0] + o.fa, best[1] + o.fl, o.step / 2), v);
    // label above the frame's far-left corner (top-left on screen)
    var x = OX + UX * (best[0] + o.fa) + RX * best[1], y = OY + UY * (best[0] + o.fa) + RY * best[1];
    if (v.proj(x, y, sceneZ(x, y))) label(o.label, v.out[0], v.out[1] - 10, 0.9 * o.a);
    ctx.lineJoin = "round";
    ctx.globalAlpha = 1;
  }
  // The aerial survey (u 0..1, owner's pick 2026-10-13): one row of SV.n photos along the route over
  // Wiehre, taken one after another, with no aircraft, track, plan lines or corner marks: only the photos.
  // Each new one exposes with a short soft flash; the newest is outlined and labelled. Inside them the
  // OpenStreetMap features are drawn like an architectural card model (FEAT_STYLE). Everything sits in the
  // landscape, draped on the terrain.
  function surveyFrame(j) {                          // photo j: [a0, l0] in route coordinates
    var len = SV.fa + (SV.n - 1) * SV.da;
    return [surveyS - len / 2 + j * SV.da, -SV.fl / 2];
  }
  function drawSurvey(a, u, v, ink) {
    var q = -0.8 + u * (SV.n - 1 + 1.6);           // photos taken so far, with a pause before and after
    var w2 = function (al, l) { return [OX + UX * al + RX * l, OY + UY * al + RY * l]; };
    var shot = [], newest = null;
    for (var j = 0; j < SV.n && j <= q + 1e-6; j++) {
      var fr = surveyFrame(j);
      shot.push({ path: routeRect(fr[0], fr[1], fr[0] + SV.fa, fr[1] + SV.fl, 100), fr: fr, age: q - j });
      newest = fr;
    }
    if (!shot.length) return;
    function trace(path) {
      var n = 0;
      for (var i = 0; i < path.length; i += 2) {
        if (!v.proj(path[i], path[i + 1], sceneZ(path[i], path[i + 1]))) continue;
        if (n++) ctx.lineTo(v.out[0], v.out[1]); else ctx.moveTo(v.out[0], v.out[1]);
      }
      ctx.closePath();
    }
    ctx.lineJoin = "miter";
    // the mosaic: all photos taken so far as one seamless area (one fill, so overlaps do not show)
    ctx.beginPath();
    shot.forEach(function (s) { trace(s.path); });
    ctx.fillStyle = color("--paper");             // the photos cover the terrain lines below them
    ctx.globalAlpha = 0.85 * a;
    ctx.fill();
    // a new photo flashes softly as it is exposed
    shot.forEach(function (s) {
      var c = [[0, 0], [1, 0], [1, 1], [0, 1]].map(function (o) {
        var g = w2(s.fr[0] + o[0] * SV.fa, s.fr[1] + o[1] * SV.fl);
        return v.proj(g[0], g[1], sceneZ(g[0], g[1])) ? [v.out[0], v.out[1]] : null;
      });
      if (c.some(function (p) { return !p; })) return;
      var flash = 1 - clamp(s.age / 0.6, 0, 1);
      if (flash > 0) {
        ctx.beginPath();
        c.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
        ctx.closePath();
        ctx.fillStyle = ink;
        ctx.globalAlpha = 0.1 * flash * flash * a;
        ctx.fill();
      }
    });
    // what the photos show: the map features, only inside the photos taken so far. They are drawn once
    // into an offscreen canvas and re-used: looking (almost) straight down, a camera move is close to a
    // shift and scale of that picture, so each frame maps three ground points from the cached view to the
    // current one (affine) and draws the cache with that transform. It is redrawn when the zoom or tilt has
    // drifted too far, or once the camera rests. As the camera tilts towards the drone view the map fades
    // out over the first degrees (featA) instead, with no repaint during the tilt, so it never warps or snaps.
    var tiltDeg = -v.pitch * 180 / Math.PI, featA = clamp((tiltDeg - 80) / 7, 0, 1);
    if (feats && featA > 0.01) {
      ctx.save();
      ctx.beginPath();
      shot.forEach(function (s) { trace(s.path); });
      ctx.clip();
      var key = [v.CX / 2, v.CY / 2, v.CZ / 2, v.key, ex * 100, w, h, dpr, ink].map(function (x) { return typeof x === "number" ? Math.round(x) : x; }).join();
      var refs = [[-500, -400], [500, -400], [0, 500]].map(function (r) {
        var g = w2(surveyS + r[0], r[1]);
        return v.proj(g[0], g[1], sceneZ(g[0], g[1])) ? [v.out[0], v.out[1]] : null;
      });
      var fc = featCache, M = refs[0] && refs[1] && refs[2] && fc.refs ? affine(fc.refs, refs) : null;
      var drift = M ? Math.abs(Math.log(Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])))) : 9;
      var rested = key === featKey && fc.key !== key;
      var tilting = tiltDeg < 87 && M;               // mid-tilt: keep the cached picture, just fade it
      if (refs[0] && refs[1] && refs[2] && !tilting && (!M || drift > 0.35 || Math.abs(v.pitch - fc.pitch) > 0.05 || fc.size !== w + "x" + h + "x" + dpr + ink || rested)) {
        if (!fc.canvas) fc.canvas = document.createElement("canvas");
        fc.canvas.width = canvas.width; fc.canvas.height = canvas.height;
        var cc = fc.canvas.getContext("2d");
        cc.setTransform(dpr, 0, 0, dpr, 0, 0);
        paintFeatures(cc, v);
        fc.key = key; fc.refs = refs; fc.pitch = v.pitch; fc.size = w + "x" + h + "x" + dpr + ink;
        M = [1, 0, 0, 1, 0, 0];
      }
      if (M) {
        ctx.globalAlpha = 0.85 * a * featA;
        ctx.setTransform(dpr * M[0], dpr * M[1], dpr * M[2], dpr * M[3], dpr * M[4], dpr * M[5]);
        ctx.drawImage(fc.canvas, 0, 0, w, h);
      }
      featKey = key;
      ctx.restore();
    }
    // the newest photo: outlined and labelled
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.9 * a;
    strokeDraped(routeRect(newest[0], newest[1], newest[0] + SV.fa, newest[1] + SV.fl, 50), v);
    var lc = w2(newest[0] + SV.fa, newest[1]);
    if (v.proj(lc[0], lc[1], sceneZ(lc[0], lc[1]))) label(T.frames, v.out[0], v.out[1] - 10, 0.9 * a);
    ctx.lineJoin = "round";
    ctx.globalAlpha = 1;
  }
  // The survey's map features (OpenStreetMap), drawn like an architectural card model (owner's pick,
  // 2026-10-13, over survey sheet, figure-ground, pencil, dots, blueprint, street network and cadastral
  // styles): only water, roads and buildings. [layer, colour, line width, fill (an opacity, or "extrude"), dash];
  // layer order from below. Main roads are cased double lines; buildings are raised blocks: a grey side under a
  // paper roof lifted a few pixels, outlined.
  var featKey = "", featCache = { key: "", canvas: null, refs: null, pitch: 0, size: "" };
  var FEAT_STYLE = [
    ["water", "--water", 0.8, 0.5, null], ["river", "--water", 3.2, 0, null], ["stream", "--water", 1.1, 0, null],
    ["minor", "--muted", 1, 0, null], ["major", "--muted", 3.2, 0, null], ["building", "--ink", 0.45, "extrude", null],
  ];
  // the affine transform [a, b, c, d, e, f] mapping three screen points src onto dst
  function affine(src, dst) {
    var x0 = src[0][0], y0 = src[0][1], x1 = src[1][0] - x0, y1 = src[1][1] - y0, x2 = src[2][0] - x0, y2 = src[2][1] - y0;
    var det = x1 * y2 - x2 * y1;
    if (Math.abs(det) < 1e-6) return null;
    var u1 = dst[1][0] - dst[0][0], v1 = dst[1][1] - dst[0][1], u2 = dst[2][0] - dst[0][0], v2 = dst[2][1] - dst[0][1];
    var A = (u1 * y2 - u2 * y1) / det, C = (u2 * x1 - u1 * x2) / det, B = (v1 * y2 - v2 * y1) / det, D = (v2 * x1 - v1 * x2) / det;
    return [A, B, C, D, dst[0][0] - A * x0 - C * y0, dst[0][1] - B * x0 - D * y0];
  }
  function paintFeatures(c, v) {
    var half = (SV.fa + (SV.n - 1) * SV.da) / 2 + 150, side = SV.fl / 2 + 150;
    FEAT_STYLE.forEach(function (st) {
      var list = feats[st[0]], closed = typeof st[3] === "string" || st[3] > 0;
      if (!list) return;
      var trace = function (dy) {                   // the layer's path, shifted up by dy px
        c.beginPath();
        list.forEach(function (f) {
          var b = f.b;
          if (b[1] < surveyS - half || b[0] > surveyS + half || b[3] < -side || b[2] > side) return;
          var P = f.p, n = 0;
          for (var i = 0; i < P.length; i += 3) {
            if (!v.proj(P[i], P[i + 1], (P[i + 2] - H0) * ex)) { n = 0; continue; }
            if (n++) c.lineTo(v.out[0], v.out[1] + dy); else c.moveTo(v.out[0], v.out[1] + dy);
          }
          if (closed && n > 2) c.closePath();
        });
      };
      c.setLineDash(st[4] || []);
      c.lineJoin = "round";
      c.lineCap = "round";
      if (st[3] === "extrude") {              // a card model: grey sides, the paper roof lifted, outlined
        trace(0);
        c.fillStyle = color("--muted"); c.globalAlpha = 0.55; c.fill();
        trace(-2.6);
        c.fillStyle = color("--paper"); c.globalAlpha = 1; c.fill();
        c.strokeStyle = color(st[1]); c.lineWidth = st[2]; c.globalAlpha = 0.8; c.stroke();
        return;
      }
      trace(0);
      if (closed) { c.fillStyle = color(st[1]); c.globalAlpha = st[3]; c.fill(); }
      if (st[2]) {
        c.strokeStyle = color(st[1]);
        c.lineWidth = st[2];
        c.globalAlpha = 1;
        c.stroke();
        if (st[0] === "major") {              // open the road: a paper core inside the casing
          c.strokeStyle = color("--paper");
          c.lineWidth = 1.5;
          c.stroke();
        }
      }
      c.setLineDash([]);
    });
    c.lineCap = "butt";
    c.globalAlpha = 1;
  }

  // Drone: we look through its camera, so a viewfinder (corner brackets and a
  // centre cross) frames the view.
  function drawViewfinder(a, px, py, ink) {
    var bw = Math.min(w * 0.3, 420), bh = bw * 0.62, x0 = px - bw / 2, y0 = py - bh / 2, c = 18;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.85 * a;
    ctx.beginPath();
    [[x0, y0, 1, 1], [x0 + bw, y0, -1, 1], [x0, y0 + bh, 1, -1], [x0 + bw, y0 + bh, -1, -1]].forEach(function (q) {
      ctx.moveTo(q[0] + q[2] * c, q[1]);
      ctx.lineTo(q[0], q[1]);
      ctx.lineTo(q[0], q[1] + q[3] * c);
    });
    ctx.moveTo(px - 8, py); ctx.lineTo(px + 8, py);
    ctx.moveTo(px, py - 8); ctx.lineTo(px, py + 8);
    ctx.stroke();
    label(T.corridor, x0, y0 - 10, a);
    ctx.globalAlpha = 1;
  }
  // a mono map label, kept off the altimeter on the right
  function label(text, x, y, a) {
    setLabelFont(1.5);
    if (x + ctx.measureText(text).width > (w >= 900 ? w - 230 : w - 8)) return;
    ctx.textAlign = "left";
    ctx.fillStyle = color("--ink");
    ctx.globalAlpha = a;
    ctx.fillText(text, x, y);
  }

  function lonLat(x, y) {
    var t = [1, x, y, x * x, x * y, y * y];
    var poly = function (k) { return k.reduce(function (sum, v, i) { return sum + v * t[i]; }, 0); };
    return [poly(meta.lonlat.lon), poly(meta.lonlat.lat)];
  }
  function num(v, digits) { return Math.abs(v).toFixed(digits).replace(".", T.dec); }

  // Ease the camera towards its target (~0.2 s; height in log space). While it
  // moves, quality adapts to the measured draw time (budget ~7 ms); when it
  // rests, one last frame at full quality.
  function frame(now) {
    var dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    var goal = target();
    var k = reduce.matches ? 1 : 1 - Math.exp(-dt / 0.2);
    var moving = false;
    ["s", "la", "pitch", "cx", "cy", "yaw", "boost", "zoom", "fin"].forEach(function (key) {
      cur[key] += (goal[key] - cur[key]) * k;
      var eps = key === "s" ? 1 : 1e-3;
      if (Math.abs(goal[key] - cur[key]) > eps) moving = true;
    });
    if (drawMs > 7) qMoving = Math.min(2.5, qMoving * 1.15);
    else if (drawMs < 4) qMoving = Math.max(1, qMoving * 0.95);
    q = moving ? qMoving : 1;
    draw(cur);
    if (moving) requestAnimationFrame(frame);
    else running = false;
  }
  function kick() {
    if (running || !cur) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }

  // chapters get a screen each (CSS) right away, so the layout does not jump later
  if (orbit && !reduce.matches) root.classList.add("ds-on");

  function start() {
    fetch(base + "region-contours.json")
      .then(function (r) { return r.json(); })
      .then(function (m) {
        meta = m;
        return fetch(base + m.grid.file).then(function (r) { return r.arrayBuffer(); });
      })
      .then(function (buf) {
        dem = new Int16Array(buf);
        buildGround();
        document.body.insertBefore(canvas, document.body.firstChild);
        document.body.appendChild(hud);
        if (orbit) document.body.appendChild(alti);
        resize();
        readColors();
        cur = target();
        draw(cur);
        window.addEventListener("resize", function () { resize(); draw(cur); });
        window.addEventListener("scroll", function () { if (!reduce.matches) kick(); }, { passive: true });
        var redraw = function () { readColors(); draw(cur); };
        new MutationObserver(redraw).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
        if (document.fonts) document.fonts.ready.then(function () { layoutKeys(); redraw(); });
      })
      .catch(function () {});
  }
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start);
})();

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
// climbs to orbit (Earth's limb, 5° graticule, country outlines, a Sentinel-2
// swath over Freiburg), descends to ~1 km looking straight down
// (overlapping aerial photo frames) and tilts forward at drone height (a camera
// viewfinder). The keyframes sit on the chapters' real positions; an
// altimeter on the right edge follows the height, and the active chapter is
// emphasised. Reduced motion: one still frame, chapters as a plain list.
//
// Data: assets/topo/region-contours.{json,dem.bin} (400 x 360 cells of 100 m,
// x east, y south, row 0 = north); assets/topo/earth.json (Natural Earth,
// tools/orbit/build_earth.py), loaded when [02] comes near.
(function () {
  var root = document.documentElement;
  var hero = document.querySelector("[data-topo]");
  var base = hero ? hero.getAttribute("data-topo") : "assets/topo/";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  var orbit = document.getElementById("orbit");
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
  var STEP = 150, FAR = 14000;
  var CRUISE = 1300;         // height above the highest ground ahead (scene m)
  var R_EARTH = 6371000;
  var CENTER_LL = [48.0, 7.81], CENTER_XY = [20000, 18000]; // region centre
  var ORBIT_H = 705000, AERIAL_H = 1000, DRONE_H = 100;     // as in the chapters' spec lines
  var S2_TRACK = 13, S2_HALF = 145000; // Sentinel-2: ground track ~13° east of north here, 290 km swath

  var T = de
    ? { title: "Flug über den Schwarzwald", route: "Freiburg → Feldberg", 
        alt: "Höhe", E: "O", dec: ",",
        swath: "SENTINEL-2 · AUFNAHMEBREITE 290 KM", frames: "LUFTBILD · 20 CM",
        corridor: "DROHNENKAMERA · ~2 CM", platforms: ["Satellit", "Flugzeug", "Drohne"] }
    : { title: "Flight over the Black Forest", route: "Freiburg → Feldberg", 
        alt: "alt", E: "E", dec: ".",
        swath: "SENTINEL-2 · 290 KM SWATH", frames: "AERIAL PHOTO · 20 CM",
        corridor: "DRONE CAMERA · ~2 CM", platforms: ["satellite", "aircraft", "drone"] };

  var canvas = document.createElement("canvas");
  canvas.className = "backdrop";
  canvas.setAttribute("aria-hidden", "true");
  var ctx = canvas.getContext("2d");
  var w = 0, h = 0, dpr = 1;
  var dem = null, meta = null, earth = null, earthLoading = false;
  var cur = null, last = 0, running = false;
  var keys = null, zones = [0.33, 0.66];
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
  function sceneZ(x, y) { return (elev(x, y) - H0) * EX; }
  // reference ground: the highest point in the next 6 km (scene units)
  function ground(s) {
    var hi = 0;
    for (var d = 0; d <= 6000; d += 250) hi = Math.max(hi, elev(OX + UX * (s + d), OY + UY * (s + d)));
    return (hi - H0) * EX;
  }
  function loadEarth() {
    if (earthLoading) return;
    earthLoading = true;
    fetch(base + "earth.json")
      .then(function (r) { return r.json(); })
      .then(function (d) { earth = d; if (cur) draw(cur); })
      .catch(function () {});
  }

  // ---------------------------------------------------------- helpers --
  function color(name) { return getComputedStyle(root).getPropertyValue(name).trim(); }
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
  // heading°]. The camera holds each platform's height while its chapter is centred; in orbit
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
      [0, CRUISE, 0, 0.5, 0.26, ROUTE_BRG],
      [Math.max(0.04, c[0] - 0.35 * g1), ORBIT_H, -58, 0.66, 0.62, 0],
      [c[0] + 0.15 * g1, ORBIT_H, -62, 0.66, 0.62, 0],
      [c[0] + 0.55 * g1, 30000, -86, 0.66, 0.5, ROUTE_BRG],
      [c[1] - 0.15 * g1, AERIAL_H, -89, 0.66, 0.5, ROUTE_BRG],
      [c[1] + 0.2 * g2, AERIAL_H, -89, 0.66, 0.5, ROUTE_BRG],
      [c[2] - 0.1 * g2, DRONE_H, -28, 0.66, 0.42, ROUTE_BRG],
      [c[2] + 0.3 * g3, DRONE_H, -24, 0.66, 0.42, ROUTE_BRG],
      [1, CRUISE, 0, 0.5, 0.26, ROUTE_BRG],
    ];
    for (var i = 1; i < k.length; i++) k[i][0] = Math.max(k[i][0], k[i - 1][0] + 0.005);
    keys = k;
    zones = [(c[0] + c[1]) / 2, (c[1] + c[2]) / 2];
  }

  // camera target from the scroll position: s along the route, log height,
  // pitch (rad), screen centre (fractions)
  function target() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var p = reduce.matches ? 0.35 : clamp(window.scrollY / (max || 1), 0, 1);
    var cam = { s: p * (ROUTE_LEN - END_GAP), la: Math.log(CRUISE), pitch: 0, cx: 0.5, cy: 0.26, yaw: ROUTE_BRG };
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
    }
    return cam;
  }

  // ------------------------------------------------------------- draw --
  function draw(cam) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var alt = Math.exp(cam.la), pitchDeg = (-cam.pitch * 180) / Math.PI;
    var G = ground(cam.s);
    var CX = OX + UX * cam.s, CY = OY + UY * cam.s, CZ = G + alt;
    var cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    var hx = Math.sin((cam.yaw * Math.PI) / 180), hy = -Math.cos((cam.yaw * Math.PI) / 180), rx = -hy, ry = hx;
    var F = Math.max(w, h) * 0.42, PX = w * cam.cx, PY = h * cam.cy;
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
    var view = { alt: alt, CX: CX, CY: CY, CZ: CZ, proj: proj, out: out };
    var paper = color("--paper"), line = color("--contour"), ink = color("--ink");
    var t = orbitT();
    var inOrbit = !!keys && t > 0 && t < 1;
    var live = inOrbit && cam.pitch < -0.02;

    // --- the Earth from orbit (above ~25 km), outlines down to ~8 km
    var orbA = clamp((alt - 25000) / 75000, 0, 1);
    var mapA = clamp((alt - 8000) / 12000, 0, 1);
    if (orbA > 0) drawGlobe(orbA, view, line);
    if (mapA > 0 && earth) drawEarth(mapA, view, ink);
    if (alt > 60000) drawSwath(clamp((alt - 60000) / 140000, 0, 1), view, ink, line);

    // --- terrain: cross-section lines at fixed distances along the route
    var terrA = clamp((90000 - alt) / 60000, 0, 1);
    var drawn = [];
    if (terrA > 0) {
      var lvl = clamp(Math.log2(alt / CRUISE), -2, 6), n0 = Math.floor(lvl), frac = lvl - n0;
      var step = STEP * Math.pow(2, n0);
      // ground distances covered by the view (bottom and top screen edges)
      var aBot = -cam.pitch + Math.atan((h - PY) / F), aTop = -cam.pitch - Math.atan(PY / F);
      var H = Math.max(CZ, 1);
      var aMin = aBot >= Math.PI / 2 - 1e-3 ? -H * Math.tan(aBot - Math.PI / 2) : H / Math.tan(aBot);
      var aMax = aTop <= 0.02 ? FAR : Math.min(Math.max(FAR, alt * 3), H / Math.tan(aTop));
      aMin = cam.s + aMin - 2 * step;
      aMax = cam.s + aMax + 2 * step;
      while ((aMax - aMin) / step > 160) { step *= 2; n0++; frac = 0; }
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
        var alpha = (0.25 + 0.75 * Math.pow(near, 1.3)) * thin * terrA;
        if (alpha < 0.03) continue;
        var dl = Math.max(25, (3.5 * dist) / F);
        dl = 25 * Math.pow(2, Math.round(Math.log2(dl / 25)));
        // the ridge line, and below it its base at sea level: the "curtain"
        // between them hides what lies behind (works level and looking down)
        var pts = [], basePts = [], top = Infinity;
        for (var l = Math.ceil(lo / dl) * dl; l <= hi; l += dl) {
          var X = px + RX * l, Y = py + RY * l;
          if (!proj(X, Y, sceneZ(X, Y))) continue;
          var sx = out[0], sy = out[1];
          pts.push(sx, sy);
          if (proj(X, Y, -H0 * EX)) basePts.push(out[0], Math.max(out[1], sy));
          else basePts.push(sx, h + 4);
          if (sy < top) top = sy;
        }
        if (pts.length < 4 || top > h + 2) continue;
        var minX = Infinity, maxX = -Infinity;
        for (var j = 0; j < pts.length; j += 2) { minX = Math.min(minX, pts[j]); maxX = Math.max(maxX, pts[j]); }
        if (maxX < 0 || minX > w) continue;
        drawn.push([a - cam.s, pts]);
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        for (j = 2; j < pts.length; j += 2) ctx.lineTo(pts[j], pts[j + 1]);
        for (j = basePts.length - 2; j >= 0; j -= 2) ctx.lineTo(basePts[j], basePts[j + 1]);
        ctx.closePath();
        ctx.globalAlpha = 1;
        if (cam.pitch > -1.2) ctx.fill(); // looking (almost) straight down nothing hides anything
        ctx.beginPath(); // stroke the ridge only, not the curtain's edges
        ctx.moveTo(pts[0], pts[1]);
        for (j = 2; j < pts.length; j += 2) ctx.lineTo(pts[j], pts[j + 1]);
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 0.6 + 1.1 * near * near;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // --- what each platform covers: aerial survey frames, then a drone corridor
    if (live) {
      var aerialA = clamp((6000 - alt) / 3000, 0, 1) * clamp((pitchDeg - 60) / 20, 0, 1);
      if (aerialA > 0.02) drawFrames(aerialA, cam.s, view, ink);
      var droneA = clamp((pitchDeg - 8) / 12, 0, 1) * clamp((50 - pitchDeg) / 10, 0, 1) * clamp((700 - alt) / 400, 0, 1);
      if (droneA > 0.02) drawViewfinder(droneA, PX, PY, ink);
    }

    // --- summits ahead (level flight only): a tick and the name, like a map label
    if (cam.pitch > -0.6 && alt < 5000) {
      setLabelFont(1.5);
      ctx.textAlign = "center";
      ctx.fillStyle = ink;
      (meta.places || []).forEach(function (pl) {
        if (pl.kind !== "summit") return;
        var d = (pl.x - CX) * UX + (pl.y - CY) * UY;
        if (d < 1500 || d > 9000 || !proj(pl.x, pl.y, (pl.elev - H0) * EX)) return;
        var sx = out[0], sy = out[1];
        if (sx < 40 || sx > w - 40 || sy < 20 || sy > h) return;
        if (hiddenBehind(drawn, d, sx, sy)) return;
        ctx.globalAlpha = clamp((9000 - d) / 2500, 0, 1) * 0.9;
        ctx.fillRect(sx - 0.5, sy - 14, 1, 9);
        ctx.fillText((de ? pl.de : pl.en).toUpperCase() + "  " + pl.elev + " m", sx, sy - 20);
      });
      ctx.globalAlpha = 1;
    }

    // --- Freiburg marked while looking down (accent: "you are here")
    if (live && pitchDeg > 40 && proj(FREIBURG[0], FREIBURG[1], sceneZ(FREIBURG[0], FREIBURG[1]))) {
      var mx = out[0], my = out[1];
      ctx.globalAlpha = clamp((pitchDeg - 40) / 15, 0, 1);
      ctx.strokeStyle = color("--accent-mark");
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(mx, my, 6, 0, Math.PI * 2);
      ctx.moveTo(mx - 12, my); ctx.lineTo(mx - 3, my);
      ctx.moveTo(mx + 3, my); ctx.lineTo(mx + 12, my);
      ctx.moveTo(mx, my - 12); ctx.lineTo(mx, my - 3);
      ctx.moveTo(mx, my + 3); ctx.lineTo(mx, my + 12);
      ctx.stroke();
      setLabelFont(2);
      ctx.textAlign = "left";
      ctx.fillStyle = ink;
      ctx.fillText("FREIBURG", mx + 16, my + 3.5);
      ctx.globalAlpha = 1;
    }

    // --- page state: section emphasis, altimeter, opacity, readout
    root.classList.toggle("orbit-live", inOrbit && !reduce.matches);
    if (inOrbit) {
      var zone = t < zones[0] ? 0 : t < zones[1] ? 1 : 2;
      chapters.forEach(function (c, i) { c.classList.toggle("is-active", i === zone); });
      alti.querySelectorAll(".is-platform").forEach(function (el) {
        el.classList.toggle("is-active", Number(el.dataset.i) === zone);
      });
      altiMark.style.top = clamp(altiY(alt), 0, 100).toFixed(2) + "%";
      altiMark.firstChild.textContent = fmtHeight(alt);
    }
    var share = orbitShare();
    canvas.style.setProperty("--fade", String(keys ? 1 : 1 - 0.85 * share));
    if (share > 0 && !earth) loadEarth();
    var ll = lonLat(CX, CY), realAlt = alt + G / EX + H0;
    hud.children[0].textContent = T.title;
    hud.children[1].textContent = T.route;
    hud.children[2].textContent = num(ll[1], 3) + "°N " + num(ll[0], 3) + "°" + T.E + " · " + T.alt + " " + fmtHeight(realAlt);
    var heroGone = !hero || hero.getBoundingClientRect().bottom < h * 0.5;
    hud.classList.toggle("is-on", heroGone && share < 0.3);
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
  // stroke a lat/lon path ([lon, lat, lon, lat, ...]), skipping hidden parts
  function strokeLonLat(flat, v) {
    ctx.beginPath();
    var pen = false;
    for (var i = 0; i < flat.length; i += 2) {
      var P = onSphere(flat[i + 1], flat[i]);
      if (facing(P, v) && v.proj(P[0], P[1], P[2])) {
        if (pen) ctx.lineTo(v.out[0], v.out[1]);
        else ctx.moveTo(v.out[0], v.out[1]);
        pen = true;
      } else pen = false;
    }
    ctx.stroke();
  }
  function drawGlobe(a, v, line) {
    ctx.strokeStyle = line;
    ctx.lineJoin = "round";
    ctx.lineWidth = 0.8;
    var lat, lon, path, x;
    for (lat = 20; lat <= 75; lat += 5) {
      for (path = [], x = -40; x <= 55; x += 0.5) path.push(x, lat);
      ctx.globalAlpha = a * 0.45;
      strokeLonLat(path, v);
    }
    for (lon = -40; lon <= 55; lon += 5) {
      for (path = [], x = 20; x <= 76; x += 0.5) path.push(lon, x);
      ctx.globalAlpha = a * 0.45;
      strokeLonLat(path, v);
    }
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
  // Sentinel-2's 290 km swath along a ground track through Freiburg
  function drawSwath(a, v, ink, line) {
    var f = lonLat(FREIBURG[0], FREIBURG[1]), left = [], right = [], track = [];
    for (var d = -3000e3; d <= 3000e3; d += 50e3) {
      var P = d < 0 ? dest(f[1], f[0], S2_TRACK + 180, -d) : dest(f[1], f[0], S2_TRACK, d);
      var N = d + 1e3 < 0 ? dest(f[1], f[0], S2_TRACK + 180, -(d + 1e3)) : dest(f[1], f[0], S2_TRACK, d + 1e3);
      var b = bearing(P, N);
      var L = dest(P[0], P[1], b - 90, S2_HALF), R = dest(P[0], P[1], b + 90, S2_HALF);
      left.push(L[1], L[0]);
      right.push(R[1], R[0]);
      track.push(P[1], P[0]);
    }
    // fill between the visible parts of both edges
    function collect(flat) {
      var pts = [];
      for (var i = 0; i < flat.length; i += 2) {
        var S = onSphere(flat[i + 1], flat[i]);
        if (facing(S, v) && v.proj(S[0], S[1], S[2])) pts.push([v.out[0], v.out[1]]);
      }
      return pts;
    }
    var poly = collect(left).concat(collect(right).reverse());
    if (poly.length > 3) {
      ctx.beginPath();
      poly.forEach(function (q, i) { if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
      ctx.closePath();
      ctx.fillStyle = line;
      ctx.globalAlpha = 0.1 * a;
      ctx.fill();
    }
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7 * a;
    strokeLonLat(left, v);
    strokeLonLat(right, v);
    ctx.setLineDash([2, 5]);
    ctx.globalAlpha = 0.45 * a;
    strokeLonLat(track, v);
    ctx.setLineDash([]);
    // label along the eastern edge, north of Freiburg
    var i = 2 * (60 + 16), S = onSphere(right[i + 1], right[i]);
    if (facing(S, v) && v.proj(S[0], S[1], S[2]) && v.out[1] > 20) label(T.swath, v.out[0] + 10, v.out[1], a);
    ctx.globalAlpha = 1;
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
  // Aerial survey: frames 1.2 x 0.8 km (20 cm pixels), 60 % forward and 30 % side overlap.
  function drawFrames(a, s, v, ink) {
    drawFootprints({ a: a, here: s - 400, from: s - 2600, to: s + 2600, fa: 800, fl: 1200, da: 320, dl: 840,
      strips: 2, step: 100, label: T.frames }, v, ink);
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

  // Ease the camera towards its target (~0.35 s; height in log space), then stop.
  function frame(now) {
    var dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    var goal = target();
    var k = reduce.matches ? 1 : 1 - Math.exp(-dt / 0.35);
    var moving = false;
    ["s", "la", "pitch", "cx", "cy", "yaw"].forEach(function (key) {
      cur[key] += (goal[key] - cur[key]) * k;
      var eps = key === "s" ? 1 : 1e-3;
      if (Math.abs(goal[key] - cur[key]) > eps) moving = true;
    });
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
        document.body.insertBefore(canvas, document.body.firstChild);
        document.body.appendChild(hud);
        if (orbit) document.body.appendChild(alti);
        resize();
        cur = target();
        draw(cur);
        window.addEventListener("resize", function () { resize(); draw(cur); });
        window.addEventListener("scroll", function () { if (!reduce.matches) kick(); }, { passive: true });
        var redraw = function () { draw(cur); };
        new MutationObserver(redraw).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
        if (document.fonts) document.fonts.ready.then(function () { layoutKeys(); redraw(); });
      })
      .catch(function () {});
  }
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start);
})();

// Page background: a low flight over the Black Forest. Ridge lines of the region
// DEM, drawn in perspective on a fixed canvas behind the page. Scrolling flies a
// straight line from Freiburg to the Feldberg; the page bottom ends looking at the
// Feldberg summit. The heading never changes, so every ridge line is fixed in the
// landscape and only comes closer (a turning camera made them morph). The camera
// eases towards the scroll position, near ridges are drawn stronger than far ones,
// summits in sight get map labels, and a small readout (wide screens, bottom-left)
// says what it is. Reduced motion: one still frame.
//
// Section [02] "From orbit to drone" (preview, 2026-10-09; picker bottom-right):
//   map      the pinned map of descent.js; the flight steps back meanwhile
//   descent  no map: the camera climbs to orbit (Earth's limb, graticule, Freiburg
//            marked) and descends through the chapters to aerial and drone height
//   strip    three calm columns with resolution icons; the flight steps back
//
// Data: assets/topo/region-contours.{json,dem.bin} (400 x 360 cells of 100 m,
// x east, y south, row 0 = north).
(function () {
  var root = document.documentElement;
  var hero = document.querySelector("[data-topo]");
  var base = hero ? hero.getAttribute("data-topo") : "assets/topo/";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  var orbit = document.getElementById("orbit");
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
  var END_GAP = 5000;        // the flight stops this far before the Feldberg
  var EX = 2.6, H0 = 170;    // vertical exaggeration, base level (m)
  var STEP = 150, FAR = 14000;
  var CRUISE = 1300;         // height above the highest ground ahead (scene m)
  var R_EARTH = 6371000;
  var CENTER_LL = [48.0, 7.81], CENTER_XY = [20000, 18000]; // region centre

  // [02] descent: section progress -> altitude (m above ground), pitch (deg), screen centre (x, y fractions)
  var KEYS = [
    [0.0, CRUISE, 0, 0.5, 0.26],
    [0.1, 705000, -58, 0.66, 0.5],
    [0.3, 705000, -62, 0.66, 0.5],
    [0.43, 30000, -86, 0.66, 0.5],
    [0.56, 1000, -89, 0.66, 0.5],
    [0.68, 1000, -89, 0.66, 0.5],
    [0.86, 120, -28, 0.66, 0.42],
    [1.0, CRUISE, 0, 0.5, 0.26],
  ];

  var T = de
    ? { title: "Flug über den Schwarzwald", route: "Freiburg → Feldberg", orbit: "Vom Orbit zur Drohne",
        orbitSub: "Abstieg über Freiburg", alt: "Höhe", E: "O", dec: ",", pick: "Abschnitt 02 (Vorschau)",
        map: "Karte", descent: "Abstieg", strip: "Leiste" }
    : { title: "Flight over the Black Forest", route: "Freiburg → Feldberg", orbit: "From orbit to drone",
        orbitSub: "Descent over Freiburg", alt: "alt", E: "E", dec: ".", pick: "Section 02 (preview)",
        map: "map", descent: "descent", strip: "strip" };

  var canvas = document.createElement("canvas");
  canvas.className = "backdrop";
  canvas.setAttribute("aria-hidden", "true");
  var ctx = canvas.getContext("2d");
  var w = 0, h = 0, dpr = 1;
  var dem = null, meta = null;
  var cur = null, last = 0, running = false;
  var hud = document.createElement("p");
  hud.className = "flight-hud";
  hud.setAttribute("aria-hidden", "true");
  hud.innerHTML = '<span class="fh-title"></span><span></span><span class="fh-pos"></span>';

  // --------------------------------------------------- [02] variant picker --
  var MODES = ["map", "descent", "strip"];
  var mode = new URLSearchParams(location.search).get("orbit");
  if (MODES.indexOf(mode) < 0) { try { mode = localStorage.getItem("orbit-preview"); } catch (e) {} }
  if (MODES.indexOf(mode) < 0) mode = "descent";
  root.dataset.orbit = mode;
  var picker = document.createElement("div");
  picker.className = "orbit-picker";
  picker.setAttribute("role", "group");
  picker.setAttribute("aria-label", T.pick);
  picker.innerHTML = "<span>" + T.pick + "</span>" + MODES.map(function (m) {
    return '<button type="button" data-orbit="' + m + '" aria-pressed="' + (m === mode) + '">' + T[m] + "</button>";
  }).join("");
  picker.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    mode = b.dataset.orbit;
    root.dataset.orbit = mode;
    try { localStorage.setItem("orbit-preview", mode); } catch (err) {}
    picker.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    kick();
  });

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

  // camera target from the scroll position: s along the route, log altitude,
  // pitch (rad), screen centre (fractions)
  function target() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var p = reduce.matches ? 0.35 : clamp(window.scrollY / (max || 1), 0, 1);
    var cam = { s: p * (ROUTE_LEN - END_GAP), la: Math.log(CRUISE), pitch: 0, cx: 0.5, cy: 0.26 };
    var t = orbitT();
    if (mode === "descent" && !reduce.matches && t > 0 && t < 1) {
      var i = 1;
      while (i < KEYS.length - 1 && KEYS[i][0] < t) i++;
      var a = KEYS[i - 1], b = KEYS[i], k = smooth((t - a[0]) / (b[0] - a[0]));
      var narrow = w < 720;
      cam.la = Math.log(a[1]) + (Math.log(b[1]) - Math.log(a[1])) * k;
      cam.pitch = ((a[2] + (b[2] - a[2]) * k) * Math.PI) / 180;
      cam.cx = narrow ? 0.5 : a[3] + (b[3] - a[3]) * k;
      cam.cy = a[4] + (b[4] - a[4]) * k;
    }
    return cam;
  }

  // ------------------------------------------------------------- draw --
  function draw(cam) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var alt = Math.exp(cam.la);
    var G = ground(cam.s);
    var CX = OX + UX * cam.s, CY = OY + UY * cam.s, CZ = G + alt;
    var cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    var F = Math.max(w, h) * 0.42, PX = w * cam.cx, PY = h * cam.cy;
    var out = [0, 0, 0];
    function proj(X, Y, Z) {
      var dx = X - CX, dy = Y - CY, dz = Z - CZ;
      var fh = dx * UX + dy * UY, rt = dx * RX + dy * RY;
      var zc = fh * cp + dz * sp, yc = -fh * sp + dz * cp;
      if (zc < 1) return false;
      out[0] = PX + (F * rt) / zc;
      out[1] = PY - (F * yc) / zc;
      out[2] = zc;
      return true;
    }
    var paper = color("--paper"), line = color("--contour"), ink = color("--ink");
    var live = mode === "descent" && cam.pitch < -0.02;

    // --- the Earth from orbit: limb and graticule (above ~25 km)
    var orbA = clamp((alt - 25000) / 75000, 0, 1);
    if (orbA > 0) drawOrbit(orbA, alt, CX, CY, proj, out, line);

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

    // --- summits ahead (level flight only): a tick and the name, like a map label
    if (cam.pitch > -0.6 && alt < 5000) {
      ctx.font = '500 10px "IBM Plex Mono", monospace';
      if ("letterSpacing" in ctx) ctx.letterSpacing = "1.5px";
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

    // --- [02] descent: Freiburg marked (accent: "you are here")
    if (live && proj(FREIBURG[0], FREIBURG[1], sceneZ(FREIBURG[0], FREIBURG[1]))) {
      var mx = out[0], my = out[1];
      ctx.globalAlpha = clamp(-cam.pitch / 0.5, 0, 1);
      ctx.strokeStyle = color("--accent-mark");
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(mx, my, 6, 0, Math.PI * 2);
      ctx.moveTo(mx - 12, my); ctx.lineTo(mx - 3, my);
      ctx.moveTo(mx + 3, my); ctx.lineTo(mx + 12, my);
      ctx.moveTo(mx, my - 12); ctx.lineTo(mx, my - 3);
      ctx.moveTo(mx, my + 3); ctx.lineTo(mx, my + 12);
      ctx.stroke();
      ctx.font = '500 10px "IBM Plex Mono", monospace';
      if ("letterSpacing" in ctx) ctx.letterSpacing = "2px";
      ctx.textAlign = "left";
      ctx.fillStyle = ink;
      ctx.fillText("FREIBURG", mx + 16, my + 3.5);
      ctx.globalAlpha = 1;
    }

    // --- opacity, mask and readout
    var share = orbitShare();
    var t = orbitT();
    var inOrbit = mode === "descent" && t > 0 && t < 1;
    root.classList.toggle("orbit-live", inOrbit && !reduce.matches);
    canvas.style.setProperty("--fade", String(mode === "descent" ? 1 : 1 - 0.85 * share));
    var ll = lonLat(CX, CY), realAlt = alt + G / EX + H0;
    hud.children[0].textContent = inOrbit ? T.orbit : T.title;
    hud.children[1].textContent = inOrbit ? T.orbitSub : T.route;
    hud.children[2].textContent = num(ll[1], 3) + "°N " + num(ll[0], 3) + "°" + T.E + " · " + T.alt + " " +
      (realAlt >= 10000 ? Math.round(realAlt / 1000).toLocaleString(root.lang) + " km"
        : Math.round(realAlt).toLocaleString(root.lang) + " m");
    var heroGone = !hero || hero.getBoundingClientRect().bottom < h * 0.5;
    hud.classList.toggle("is-on", heroGone && (inOrbit || share < 0.3));
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

  // Earth seen from above: its limb (where the view grazes the sphere) and a 1° graticule.
  function drawOrbit(orbA, alt, CX, CY, proj, out, line) {
    var R = R_EARTH;
    var lat0 = (CENTER_LL[0] * Math.PI) / 180, lon0 = (CENTER_LL[1] * Math.PI) / 180;
    // scene coordinates of a lat/lon on the sphere (local frame at the region centre)
    function onSphere(latd, lond) {
      var la = (latd * Math.PI) / 180, lo = (lond * Math.PI) / 180 - lon0;
      var e = R * Math.cos(la) * Math.sin(lo);
      var n = R * (Math.sin(la) * Math.cos(lat0) - Math.cos(la) * Math.sin(lat0) * Math.cos(lo));
      var u = R * (Math.sin(la) * Math.sin(lat0) + Math.cos(la) * Math.cos(lat0) * Math.cos(lo)) - R;
      return [CENTER_XY[0] + e, CENTER_XY[1] - n, u];
    }
    var CZ = alt; // near enough at this height
    function visible(P) {
      // the point faces the camera: (P - camera) . outward normal < 0
      var nx = (P[0] - CENTER_XY[0]) / R, ny = (P[1] - CENTER_XY[1]) / R, nz = (P[2] + R) / R;
      return (P[0] - CX) * nx + (P[1] - CY) * ny + (P[2] - CZ) * nz < 0;
    }
    ctx.strokeStyle = line;
    ctx.lineJoin = "round";
    function polyline(sample, from, to, stepd) {
      ctx.beginPath();
      var pen = false;
      for (var v = from; v <= to + 1e-9; v += stepd) {
        var P = sample(v);
        if (visible(P) && proj(P[0], P[1], P[2])) {
          if (pen) ctx.lineTo(out[0], out[1]);
          else ctx.moveTo(out[0], out[1]);
          pen = true;
        } else pen = false;
      }
      ctx.stroke();
    }
    ctx.lineWidth = 0.8;
    for (var lat = 20; lat <= 76; lat += 1) {
      ctx.globalAlpha = orbA * (lat % 5 ? 0.35 : 0.7);
      polyline(function (lo) { return onSphere(lat, lo); }, -40, 55, 0.5);
    }
    for (var lon = -40; lon <= 55; lon += 1) {
      ctx.globalAlpha = orbA * (lon % 5 ? 0.35 : 0.7);
      polyline(function (la) { return onSphere(la, lon); }, 20, 76, 0.5);
    }
    // limb: the circle on the sphere where the view grazes it, around the point below the camera
    var phi = Math.acos(R / (R + alt)), rho = R * Math.sin(phi), drop = R * (1 - Math.cos(phi));
    ctx.globalAlpha = orbA;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    var pen = false;
    for (var az = 0; az <= 360; az += 2) {
      var r = (az * Math.PI) / 180;
      if (proj(CX + rho * Math.cos(r), CY + rho * Math.sin(r), -drop)) {
        if (pen) ctx.lineTo(out[0], out[1]);
        else ctx.moveTo(out[0], out[1]);
        pen = true;
      } else pen = false;
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function lonLat(x, y) {
    var t = [1, x, y, x * x, x * y, y * y];
    var poly = function (k) { return k.reduce(function (sum, v, i) { return sum + v * t[i]; }, 0); };
    return [poly(meta.lonlat.lon), poly(meta.lonlat.lat)];
  }
  function num(v, digits) { return Math.abs(v).toFixed(digits).replace(".", T.dec); }

  // Ease the camera towards its target (~0.35 s; altitude in log space), then stop.
  function frame(now) {
    var dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    var goal = target();
    var k = reduce.matches ? 1 : 1 - Math.exp(-dt / 0.35);
    var moving = false;
    ["s", "la", "pitch", "cx", "cy"].forEach(function (key) {
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

  function start() {
    document.body.appendChild(picker);
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
        resize();
        cur = target();
        draw(cur);
        window.addEventListener("resize", function () { resize(); draw(cur); });
        window.addEventListener("scroll", function () { if (!reduce.matches) kick(); }, { passive: true });
        var redraw = function () { draw(cur); };
        new MutationObserver(redraw).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
      })
      .catch(function () {});
  }
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start);
})();

// Hero effects, PREVIEW (2026-10-11): the owner tries them before choosing.
// A picker bottom-right switches and replays them; ?hero=<mode> also works.
//   draw    the contours draw themselves like a plotter (index lines first), then
//           labels and the town label fade in, the sentence appears word by word
//   scan    a survey scan line sweeps across and reveals the map behind it
//   tilt    scrolling tilts the flat map back into 3D as you leave the hero
//   light   faint relief shading whose sun follows the mouse
//   accent  "all things spatial" gets a thin survey line drawn under it
//   draw+accent
//   rise    the flat map lifts into 3D: every contour rises to its elevation while the
//           view tilts; afterwards it follows the mouse a little and leans back on scroll
//   intro   rises once on load, holds, and settles back to the flat map
//   sun     the 3D terraces cast shadows from the real sun over Freiburg right now
//   lens    flat map; the terrain around the pointer lifts like a 3D magnifier
//   scroll-rise  the hero pins while you scroll: the map rises and turns to the Black
//           Forest, the camera pushes in, then the page continues (soft afternoon shadows)
//   glass   small glass loupes appear by themselves on hilly spots, show the terrain in
//           3D for a moment and fade; the pointer can take one over; tilt on scroll
// Reduced motion: no animation (the static hero stays as it is).
(function () {
  var root = document.documentElement;
  var hero = document.querySelector(".hero");
  var svg = hero && hero.querySelector("svg.topo");
  if (!hero || !svg) return;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var de = root.lang === "de";
  var h1 = hero.querySelector("h1");
  var mapEls = [hero.querySelector(".hero-map"), hero.querySelector(".hero-places")];
  var MODES = ["glass", "scroll-rise", "tilt", "lens", "intro", "rise", "scan", "none"];
  var LABEL = de
    ? { title: "Startbereich (Vorschau)", glass: "glas", intro: "intro", sun: "sonne", lens: "lupe", "scroll-rise": "scroll-3d", rise: "aufsteigen", none: "ohne", draw: "zeichnen", scan: "scan", tilt: "kippen", light: "licht", accent: "akzent", "draw+accent": "zeichnen+akzent", replay: "wiederholen ↺" }
    : { title: "Hero (preview)", glass: "glass", intro: "intro", sun: "sun", lens: "lens", "scroll-rise": "scroll-3d", rise: "rise", none: "none", draw: "draw", scan: "scan", tilt: "tilt", light: "light", accent: "accent", "draw+accent": "draw+accent", replay: "replay ↺" };

  var mode = new URLSearchParams(location.search).get("hero");
  if (MODES.indexOf(mode) < 0) { try { mode = localStorage.getItem("hero-preview"); } catch (e) {} }
  if (MODES.indexOf(mode) < 0) mode = "glass";
  var smooth = function (t) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

  // -------------------------------------------------- words of the sentence --
  var words = [];
  (function splitWords() {
    var text = h1.textContent;
    var phrase = de ? "alles Räumliche" : "all things spatial";
    var at = text.indexOf(phrase);
    h1.textContent = "";
    var parts = at < 0 ? [[text, false]] : [[text.slice(0, at), false], [phrase, true], [text.slice(at + phrase.length), false]];
    parts.forEach(function (p) {
      var host = h1;
      if (p[1]) {
        host = document.createElement("span");
        host.className = "hfx-hl";
        h1.appendChild(host);
      }
      p[0].split(/(\s+)/).forEach(function (w) {
        if (!w) return;
        if (/^\s+$/.test(w)) { host.appendChild(document.createTextNode(w)); return; }
        var s = document.createElement("span");
        s.className = "hfx-w";
        s.textContent = w;
        host.appendChild(s);
        words.push(s);
      });
    });
  })();
  var hl = h1.querySelector(".hfx-hl");
  // the survey line under the phrase is drawn by CSS (.hfx-hl::after / ::before)

  // ------------------------------------------- split contours for drawing --
  // The contour paths use only M m L l H h V v; each subpath becomes its own
  // element so all lines can draw at once (a dash on one long path would draw
  // them one after another).
  function subpaths(d) {
    var tok = d.match(/[MmLlHhVv]|-?\d*\.?\d+(?:e-?\d+)?/g), out = [], cur = null, x = 0, y = 0, cmd = "M", i = 0;
    var num = function () { return parseFloat(tok[i++]); };
    while (i < tok.length) {
      if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++];
      if (cmd === "M" || cmd === "m") {
        var nx = num(), ny = num();
        if (cmd === "m") { nx += x; ny += y; }
        x = nx; y = ny;
        cur = ["M" + x + " " + y]; out.push(cur);
        cmd = cmd === "m" ? "l" : "L";          // implicit lineto after moveto
      } else if (cmd === "L" || cmd === "l") {
        var lx = num(), ly = num();
        if (cmd === "l") { lx += x; ly += y; }
        x = lx; y = ly; cur.push("L" + x + " " + y);
      } else if (cmd === "H" || cmd === "h") {
        var hx = num(); x = cmd === "h" ? x + hx : hx; cur.push("L" + x + " " + y);
      } else if (cmd === "V" || cmd === "v") {
        var vy = num(); y = cmd === "v" ? y + vy : vy; cur.push("L" + x + " " + y);
      } else i++;
    }
    return out.map(function (c) { return c.join(""); });
  }
  var overlay = null;
  function buildOverlay() {
    if (overlay) return overlay;
    overlay = svg.cloneNode(false);
    overlay.setAttribute("class", "topo hfx-draw");
    ["topo-i", "topo-c"].forEach(function (cls, k) {
      var src = svg.querySelector("." + cls);
      if (!src) return;
      var g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("class", cls);
      subpaths(src.getAttribute("d")).forEach(function (d, j) {
        var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("d", d);
        p.setAttribute("pathLength", "1");
        // index contours first, then the fine ones; a little random spread
        p.style.setProperty("--delay", (k * 0.45 + Math.random() * 0.5).toFixed(2) + "s");
        g.appendChild(p);
      });
      overlay.appendChild(g);
    });
    svg.parentNode.insertBefore(overlay, svg.nextSibling);
    return overlay;
  }

  // ------------------------------------------------------------- scan line --
  var scanLine = document.createElement("div");
  scanLine.className = "hfx-scan";
  scanLine.setAttribute("aria-hidden", "true");
  hero.appendChild(scanLine);

  // ------------------------------------------------------------ relief light --
  var light = null;
  function buildLight() {
    if (light) return light;
    var box = hero.querySelector(".map-box");
    var c = document.createElement("canvas");
    c.className = "hfx-light";
    c.width = 800; c.height = 400;
    box.insertBefore(c, box.firstChild);
    light = { canvas: c, ctx: c.getContext("2d"), dem: null, az: 315 };
    fetch(hero.dataset.topo + "hero-contours-dem.bin").then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
      light.dem = new Int16Array(buf);   // 200 x 100 cells of 50 m
      paintLight();
    });
    return light;
  }
  function paintLight() {
    if (!light || !light.dem) return;
    var C = 200, R = 100, dem = light.dem, img = light.ctx.createImageData(C, R), d = img.data;
    var a = (light.az * Math.PI) / 180, alt = (38 * Math.PI) / 180, dark = root.dataset.theme === "dark" ||
      (!root.dataset.theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
    for (var r = 0; r < R; r++) for (var c = 0; c < C; c++) {
      var z = function (rr, cc) { return dem[Math.min(R - 1, Math.max(0, rr)) * C + Math.min(C - 1, Math.max(0, cc))]; };
      var gx = (z(r, c + 1) - z(r, c - 1)) / 100 * 2.5, gy = (z(r + 1, c) - z(r - 1, c)) / 100 * 2.5;
      var slope = Math.atan(Math.hypot(gx, gy)), aspect = Math.atan2(-gx, gy);
      var hs = Math.sin(alt) * Math.cos(slope) + Math.cos(alt) * Math.sin(slope) * Math.cos(a - aspect);
      var k = (r * C + c) * 4, v = hs - 0.62;     // flat ground ~ neutral
      if (v < 0) { d[k] = d[k + 1] = d[k + 2] = 0; d[k + 3] = Math.min(255, -v * (dark ? 260 : 170)); }
      else { d[k] = d[k + 1] = d[k + 2] = 255; d[k + 3] = Math.min(255, v * (dark ? 90 : 140)); }
    }
    var tmp = document.createElement("canvas"); tmp.width = C; tmp.height = R;
    tmp.getContext("2d").putImageData(img, 0, 0);
    light.ctx.imageSmoothingQuality = "high";
    light.ctx.clearRect(0, 0, 800, 400);
    light.ctx.drawImage(tmp, 0, 0, 800, 400);
  }
  var lightQueued = false;
  hero.addEventListener("pointermove", function (e) {
    if (!light || mode !== "light") return;
    var b = hero.getBoundingClientRect();
    // the sun sits where the pointer is, seen from the map centre
    light.az = (Math.atan2((e.clientX - b.left) / b.width - 0.5, -((e.clientY - b.top) / b.height - 0.5)) * 180) / Math.PI;
    if (!lightQueued) { lightQueued = true; requestAnimationFrame(function () { lightQueued = false; paintLight(); }); }
  });

  // ------------------------------------------------------------------ tilt --
  function onScroll() {
    var p = mode === "tilt" || mode === "glass" ? Math.min(1, Math.max(0, window.scrollY / (hero.offsetHeight * 0.9))) : 0;
    mapEls.forEach(function (el) {
      if (!el) return;
      el.style.transform = p ? "perspective(1100px) rotateX(" + (58 * smooth(p)).toFixed(2) + "deg) scale(" + (1 + 0.12 * p).toFixed(3) + ")" : "";
      el.style.opacity = p ? String(1 - 0.75 * smooth(p)) : "";
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });


  // ------------------------------------------------------------------ rise --
  // Stacked terraces: one paper layer per 10 m level (assets/topo/hero-terraces.json,
  // tools/hero/build_terraces.py), drawn from low to high so higher layers cover
  // lower ones, like a layered paper model. At k = 0 it matches the flat map; as
  // k grows the layers lift to their heights and the view tilts.
  var R3 = null;
  function buildRise() {
    if (R3) return Promise.resolve(R3);
    var hm = hero.querySelector(".hero-map");
    var cv = document.createElement("canvas");
    cv.className = "hfx-rise";
    cv.setAttribute("aria-hidden", "true");
    hm.appendChild(cv);
    R3 = { canvas: cv, ctx: cv.getContext("2d"), levels: [], k: 0, mx: 0, my: 0, mxs: 0, mys: 0, t0: 0, running: false, lensA: 0 };
    fetch(hero.dataset.topo + "hero-contours-dem.bin").then(function (r) { return r.arrayBuffer(); })
      .then(function (buf) { R3.dem = new Int16Array(buf); });    // 200 x 100 cells of 50 m, for the glass spots
    return fetch(hero.dataset.topo + "hero-terraces.json").then(function (r) { return r.json(); }).then(function (d) {
      R3.zmin = d.zmin;
      R3.levels = d.levels.map(function (l) { return { z: l.z - d.zmin, elev: l.z, index: l.z % 50 === 0, rings: l.rings }; });
      // label anchor per 50 m level: the westernmost contour vertex (the side facing the
      // camera, which looks east), away from the map border
      R3.levels.forEach(function (L) {
        if (!L.index) return;
        var best = null;
        L.rings.forEach(function (g) {
          for (var i = 0; i < g.length; i += 2) {
            var X = g[i], Y = g[i + 1];
            if (X < 400 || X > 9600 || Y < 400 || Y > 4600) continue;
            if (!best || X < best[0]) best = [X, Y];
          }
        });
        L.anchor = best;
      });
      var pl = hero.querySelector(".hero-place");
      if (pl) {   // the town label's map position (build_hero.py) on the lowest terrace
        var fx = parseFloat(pl.style.getPropertyValue("--fx")), fy = parseFloat(pl.style.getPropertyValue("--fy"));
        R3.place = [fx * 10000, fy * 5000, 30];
      }
      return R3;
    });
  }
  // Drone mapping mission over the model: a lawnmower survey of a block on the west-facing
  // slope in front of the camera (map metres), flown 40 m above the ground (hero DEM).
  // Planned lanes faint, flown lanes solid, the drone a small dot with a soft ring.
  var SURVEY = { x0: 6000, x1: 6750, y0: 2300, y1: 2850, lanes: 6, agl: 40 };
  var routePts = null;
  function demAt(X, Y) {
    var c = Math.min(198.999, Math.max(0, X / 50 - 0.5)), r = Math.min(98.999, Math.max(0, Y / 50 - 0.5));
    var c0 = Math.floor(c), r0 = Math.floor(r), fc = c - c0, fr = r - r0, d = R3.dem, i = r0 * 200 + c0;
    var a = d[i] + (d[i + 1] - d[i]) * fc, b = d[i + 200] + (d[i + 201] - d[i + 200]) * fc;
    return a + (b - a) * fr;
  }
  function buildSurvey() {
    var S = SURVEY, way = [], dy = (S.y1 - S.y0) / (S.lanes - 1);
    for (var l = 0; l < S.lanes; l++) {                      // lanes up and down the slope (west-east),
      var Y = S.y0 + l * dy, up = l % 2 === 0;               // along the camera's line of sight
      way.push([up ? S.x0 : S.x1, Y], [up ? S.x1 : S.x0, Y]);
    }
    var pts = [];
    for (var w = 1; w < way.length; w++) {
      var a = way[w - 1], b = way[w], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 25));
      for (var j = 0; j < n; j++) pts.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]);
    }
    pts.push(way[way.length - 1]);
    var g = pts.map(function (p) { return demAt(p[0], p[1]); });
    pts.forEach(function (p, q) {                            // terrain following, lightly smoothed
      var sum = 0, n = 0;
      for (var e = Math.max(0, q - 2); e <= Math.min(g.length - 1, q + 2); e++) { sum += g[e]; n++; }
      p[2] = sum / n + S.agl;
    });
    return pts;
  }
  function drawFlightPath(proj, ex, k) {
    var ctx = R3.ctx, css = getComputedStyle(root), o = [0, 0];
    if (!routePts) routePts = buildSurvey();
    var P = routePts.map(function (p) { proj(p[0], p[1], (p[2] - R3.zmin) * ex, o); return [o[0], o[1]]; });
    var head = R3.pathP * (P.length - 1), hi = Math.floor(head), f = head - hi;
    var accent = css.getPropertyValue("--accent-mark").trim(), appear = Math.min(1, R3.pathP * 5);
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.35 * appear; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);      // the plan
    ctx.beginPath(); P.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 0.9 * appear; ctx.lineWidth = 1.5;          // flown lanes
    ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]);
    for (var i = 1; i <= hi; i++) ctx.lineTo(P[i][0], P[i][1]);
    var hx = P[hi][0], hy = P[hi][1];
    if (hi < P.length - 1) { hx += (P[hi + 1][0] - hx) * f; hy += (P[hi + 1][1] - hy) * f; }
    ctx.lineTo(hx, hy); ctx.stroke();
    // the drone: a small dot with a soft ring
    ctx.globalAlpha = appear * (R3.pathP < 0.999 ? 1 : 0.6); ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(hx, hy, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.45 * appear; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(hx, hy, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  function mixColor(a, b, t) {                               // two #rrggbb colours
    var pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16), o = [];
    for (var sh = 16; sh >= 0; sh -= 8) o.push(Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t));
    return "rgb(" + o.join(",") + ")";
  }
  function inLevel(L, x, y) {                                 // even-odd test over all rings
    var inside = false;
    for (var r = 0; r < L.rings.length; r++) {
      var g = L.rings[r];
      for (var i = 0, j = g.length - 2; i < g.length; j = i, i += 2) {
        if ((g[i + 1] > y) !== (g[j + 1] > y) && x < ((g[j] - g[i]) * (y - g[i + 1])) / (g[j + 1] - g[i + 1]) + g[i]) inside = !inside;
      }
    }
    return inside;
  }
  function drawRise(time) {
    var hm = hero.querySelector(".hero-map"), box = hero.querySelector(".map-box");
    var W = hm.clientWidth, H = hm.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cv = R3.canvas, ctx = R3.ctx;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    var hb = hm.getBoundingClientRect(), bb = box.getBoundingClientRect();
    var s0 = bb.width / 10000, ox = bb.left - hb.left, oy = bb.top - hb.top;   // flat map: px = ox + x * s0
    var scrollP = Math.min(1, Math.max(0, window.scrollY / (hero.offsetHeight * 0.9)));
    var k = R3.k;
    var lens = mode === "lens" || mode === "glass";
    if (mode === "scroll-rise") scrollP = R3.push || 0;
    R3.mxs += (R3.mx - R3.mxs) * 0.05; R3.mys += (R3.my - R3.mys) * 0.05;
    if (mode !== "glass") R3.lensA += ((R3.inside ? 1 : 0) - R3.lensA) * 0.12;
    var lx = (R3.px || 0) - (hb.left), ly = (R3.py || 0) - (hb.top), LR = Math.max(W, H) * (mode === "glass" ? 0.075 : 0.12);
    var sway = mode === "scroll-rise" ? 0 : Math.sin(time / 4200);
    var pushT = mode === "scroll-rise" ? 4 : 14;           // scroll-rise: the push mostly zooms and turns
    var tilt = (k * TILT + scrollP * pushT + R3.mys * 4 * k) * Math.PI / 180;   // 0 = straight down
    var yaw = (k * (YAW + sway * 2.5) + R3.mxs * 8 * k + (mode === "scroll-rise" ? scrollP * 10 : 0)) * Math.PI / 180;
    var s = s0 * (1 + k * ZOOM + (mode === "scroll-rise" ? scrollP * 0.3 : 0));   // zoom in as the view tilts (and on the push)
    var ex = k * EXAG * s;                             // px per metre of height
    var ct = Math.cos(tilt), st = Math.sin(tilt), cyw = Math.cos(yaw), syw = Math.sin(yaw);
    var D = Math.max(W, H) * 1.6;                      // viewer distance (px)
    var pcx = ox + 5000 * s0, pcy = oy + 2500 * s0 + k * H * LIFT;
    var css = getComputedStyle(root);
    var paper = css.getPropertyValue("--paper").trim(), line = css.getPropertyValue("--contour").trim();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineJoin = "round";
    ctx.strokeStyle = line;
    ctx.fillStyle = paper;
    var proj = function (X, Y, Z, o) {
      var x = (X - 5000) * s, y = (Y - 2500) * s;
      var xr = x * cyw - y * syw, yr = x * syw + y * cyw;      // yaw about the map centre
      var f = D / (D - yr * st);                              // the far (north) side is smaller
      o[0] = pcx + xr * f;
      o[1] = pcy + (yr * ct - Z * st) * f;
    };
    if (lens) {
      // 3D loupe: the terrain under the pointer, risen and tilted, inside a circle
      var GL = mode === "glass";
      var LS = s0 * (GL ? 1.9 : 1.6), LT = (GL ? 64 : 48) * Math.PI / 180, lct = Math.cos(LT), lst = Math.sin(LT);
      var mX = (lx - ox) / s0, mY = (ly - oy) / s0, LD = LR * 6;
      ex = EXAG * LS * 0.8;
      var zc = 0;                                             // ground height under the pointer (nearest terrace)
      for (var q = 0; q < R3.levels.length; q++) { if (R3.levels[q].z * ex > zc && inLevel(R3.levels[q], mX, mY)) zc = R3.levels[q].z * ex; }
      proj = function (X, Y, Z, o) {
        var x = (X - mX) * LS, y = (Y - mY) * LS;            // oblique parallel view: no distortion
        o[0] = lx + x;
        o[1] = ly + LR * (GL ? 0.12 : 0.3) + y * lct - (Z - zc) * lst;
      };
      ctx.save();
      ctx.beginPath(); ctx.arc(lx, ly, LR * R3.lensA, 0, Math.PI * 2); ctx.clip();
      ctx.globalAlpha = 1; ctx.fillStyle = paper; ctx.fillRect(lx - LR, ly - LR, LR * 2, LR * 2);
    }
    // sun: shadow offset (screen px per 10 m terrace step), from the real sun position
    var shadow = null;
    var sunUse = mode === "sun" ? R3.sun : null;
    if (sunUse && sunUse.alt > 1 && k > 0.01) {
      var len = Math.min(320, (10 * EXAG) / Math.tan(sunUse.alt * Math.PI / 180));   // map metres
      var az = sunUse.az * Math.PI / 180, ddx = -Math.sin(az) * len, ddy = Math.cos(az) * len;
      var a0 = [0, 0], a1 = [0, 0];
      proj(5000, 2500, 0, a0); proj(5000 + ddx, 2500 + ddy, 0, a1);
      shadow = [(a1[0] - a0[0]) * k, (a1[1] - a0[1]) * k];
    }
    var isDark = css.getPropertyValue("--paper").trim().toLowerCase() === "#0e1215";
    var o = [0, 0];
    var lv = R3.levels;
    var SR = mode === "scroll-rise";
    var labelA = SR ? smooth((k - 0.45) / 0.4) : 0, placed = [];
    var labelCol = css.getPropertyValue(isDark ? "--muted" : "--contour").trim();
    // paper-model edge: each layer's card thickness (10 m) seen from the side, a touch darker
    var edgeCol = SR ? mixColor(paper, line, isDark ? 0.3 : 0.22) : null;
    var tmp = [0, 0], tmp2 = [0, 0];
    proj(5000, 2500, 0, tmp); proj(5000, 2500, 10 * ex, tmp2);
    var thick = SR ? Math.min(1.8, Math.max(0, tmp[1] - tmp2[1])) : 0;   // a fine card edge, not walls
    proj(5000, -2000, 0, tmp); var yFar = tmp[1]; proj(5000, 7000, 0, tmp); var yNear = tmp[1];
    for (var n = 0; n < lv.length; n++) {
      var L = lv[n], Z = L.z * ex;
      // fill: the whole layer; stroke: only the contour, not the map border
      // the lowest layer covers the whole map: it rests on the base, no shadow
      var fillPath = new Path2D(), linePath = new Path2D(), shadowPath = shadow && n > 0 ? new Path2D() : null;
      for (var r = 0; r < L.rings.length; r++) {
        var ring = L.rings[r], pen = false, prevEdge = false;
        for (var i = 0; i < ring.length; i += 2) {
          var X = ring[i], Y = ring[i + 1];
          var edge = X <= 15 || X >= 9985 || Y <= 15 || Y >= 4985;
          proj(X, Y, Z, o);
          if (i) fillPath.lineTo(o[0], o[1]); else fillPath.moveTo(o[0], o[1]);
          if (shadowPath) {                                  // map-border points do not cast: no edge streaks
            var sx2 = edge ? o[0] : o[0] + shadow[0], sy2 = edge ? o[1] : o[1] + shadow[1];
            if (i) shadowPath.lineTo(sx2, sy2); else shadowPath.moveTo(sx2, sy2);
          }
          if (pen && !(edge && prevEdge)) linePath.lineTo(o[0], o[1]); else linePath.moveTo(o[0], o[1]);
          pen = true; prevEdge = edge;
        }
        fillPath.closePath();
        if (shadowPath) shadowPath.closePath();
      }
      if (shadowPath) {                                      // cast shadow onto the layer below
        ctx.globalAlpha = (isDark ? 0.55 : 0.09) * Math.min(1, k * 2);
        ctx.fillStyle = "#000";
        ctx.fill(shadowPath, "evenodd");
        ctx.fillStyle = paper;
      }
      if (SR && thick > 0.6 && n > 0) {                       // the card's edge, under the layer
        ctx.save(); ctx.translate(0, thick); ctx.globalAlpha = Math.min(1, k * 1.5);
        ctx.fillStyle = edgeCol; ctx.fill(fillPath, "evenodd"); ctx.restore();
      }
      if (k > 0.001 || lens) { ctx.globalAlpha = 1; ctx.fillStyle = paper; ctx.fill(fillPath, "evenodd"); }
      var a = L.index ? 0.85 : 0.45;
      if (SR && k > 0.01) {                                   // atmospheric depth: far lines recede
        var cy0 = 0, cnt = 0;
        var rr0 = L.rings[0];
        for (var q = 1; q < rr0.length; q += 16) { proj(rr0[q - 1], rr0[q], Z, tmp); cy0 += tmp[1]; cnt++; }
        var depth = cnt ? Math.min(1, Math.max(0, (yNear - cy0 / cnt) / Math.max(1, yNear - yFar))) : 0;
        a *= 1 - 0.45 * k * depth;
      }
      ctx.globalAlpha = a;
      ctx.lineWidth = L.index ? 1.2 : 0.6;
      ctx.stroke(linePath);
      if (SR && L.index && L.anchor && labelA > 0.01) {      // height label on the 50 m contours
        proj(L.anchor[0], L.anchor[1], Z, tmp);
        var lxp = tmp[0], lyp = tmp[1], clear = lxp > 30 && lxp < W - 60 && lyp > 24 && lyp < H - 24 &&
          !(lxp < W * 0.42 && lyp > H * 0.6);                   // not over the sentence
        for (var u = 0; u < placed.length && clear; u++) if (Math.abs(placed[u][0] - lxp) < 64 && Math.abs(placed[u][1] - lyp) < 18) clear = false;
        if (clear) {
          placed.push([lxp, lyp]);
          ctx.globalAlpha = labelA;
          ctx.font = '500 10px "IBM Plex Mono", monospace';
          if ("letterSpacing" in ctx) ctx.letterSpacing = "1px";
          ctx.textAlign = "right";
          ctx.lineWidth = 3; ctx.strokeStyle = paper; ctx.lineJoin = "round";
          ctx.strokeText(L.elev + " m", lxp - 6, lyp + 3.5);
          ctx.fillStyle = labelCol; ctx.fillText(L.elev + " m", lxp - 6, lyp + 3.5);
          ctx.fillRect(lxp - 3, lyp - 0.5, 3, 1);
          ctx.strokeStyle = line; ctx.textAlign = "left";
        }
      }
    }
    // drone flight path over the model during the push-in (scroll-rise)
    if (SR && R3.dem && R3.pathP > 0.01) drawFlightPath(proj, ex, k);
    if (lens) {
      ctx.restore();
      if (R3.lensA > 0.02) {                                  // the loupe's rim and a centre tick
        ctx.globalAlpha = R3.lensA;
        ctx.strokeStyle = css.getPropertyValue("--ink").trim();
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(lx, ly, LR * R3.lensA, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = css.getPropertyValue("--accent-mark").trim();
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(lx, ly, LR * R3.lensA + 4, -0.6, 0.6); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      return;
    }
    if (mode === "sun" && R3.sun && k > 0.5) {
      ctx.globalAlpha = Math.min(1, (k - 0.5) * 2) * 0.85;
      ctx.fillStyle = css.getPropertyValue("--muted").trim();
      ctx.font = '400 11px "IBM Plex Mono", monospace';
      if ("letterSpacing" in ctx) ctx.letterSpacing = "1px";
      ctx.textAlign = "right";
      ctx.fillText(R3.sun.label, W - 24, 28);
      ctx.textAlign = "left";
    }
    // Freiburg (Münster) as a map label on the terrain
    if (R3.place && !lens) {
      proj(R3.place[0], R3.place[1], R3.place[2] * ex, o);
      ctx.globalAlpha = 1;
      ctx.fillStyle = css.getPropertyValue("--ink").trim();
      ctx.beginPath(); ctx.arc(o[0], o[1], 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.font = '500 12px "IBM Plex Mono", monospace';
      if ("letterSpacing" in ctx) ctx.letterSpacing = "2.5px";
      ctx.fillText(de ? "FREIBURG IM BREISGAU" : "FREIBURG IM BREISGAU", o[0] + 12, o[1] + 4);
    }
    ctx.globalAlpha = 1;
  }
  var TILT = 66, YAW = -80, ZOOM = 1.25, EXAG = 3.6, LIFT = 0.55;
  hero.addEventListener("pointermove", function (e) {
    if (!R3) return;
    var b = hero.getBoundingClientRect();
    R3.mx = ((e.clientX - b.left) / b.width - 0.5) * 2;
    R3.my = ((e.clientY - b.top) / b.height - 0.5) * 2;
    if (mode === "glass") return;                            // glass loupes are automatic only
    R3.px = e.clientX; R3.py = e.clientY; R3.inside = true;
  });
  hero.addEventListener("pointerleave", function () { if (R3 && mode !== "glass") R3.inside = false; });

  // Sun position over Freiburg now (NOAA simplified solar position).
  function sunNow(at) {
    var d = at || new Date(), lat = 47.995 * Math.PI / 180, lon = 7.85;
    var jd = d.getTime() / 86400000 + 2440587.5, n = jd - 2451545.0;
    var L = (280.46 + 0.9856474 * n) % 360, g = ((357.528 + 0.9856003 * n) % 360) * Math.PI / 180;
    var lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * Math.PI / 180, eps = (23.439 - 4e-7 * n) * Math.PI / 180;
    var ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)), dec = Math.asin(Math.sin(eps) * Math.sin(lam));
    var gmst = (18.697374558 + 24.06570982441908 * n) % 24, lst = (gmst * 15 + lon) * Math.PI / 180, ha = lst - ra;
    var alt = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha));
    var az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(ha));
    var azd = (az * 180 / Math.PI + 360) % 360, altd = alt * 180 / Math.PI;
    var hh = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    if (altd < 5 && !at) {               // night or dusk: show this afternoon's sun instead, and say so
      var day = new Date(d); day.setHours(16, 0, 0, 0);
      var r = sunNow(day);
      r.label = (de ? "SONNE ÜBER FREIBURG HEUTE 16:00" : "SUN OVER FREIBURG TODAY 16:00") + r.label.slice(r.label.indexOf(" · AZ"));
      return r;
    }
    var label = (de ? "SONNE ÜBER FREIBURG " : "SUN OVER FREIBURG ") + hh + " · AZ " + Math.round(azd) + "° · " +
      (de ? "HÖHE " : "ALT ") + Math.round(altd) + "°";
    return { az: azd, alt: altd, label: label };
  }
  var CANVAS_MODES = { rise: 1, intro: 1, sun: 1, lens: 1, "scroll-rise": 1, glass: 1 };
  // glass: a loupe appears on a hilly, visible spot (not over the sentence or the
  // map controls), holds ~2.6 s, fades; a short pause; the next one elsewhere.
  // While the pointer is over the map it follows the pointer instead.
  var G = { phase: "wait", t0: 0, x: 0, y: 0, last: [] };
  var SHOW = 2800, OPEN = 750, CLOSE = 650, PAUSE = 1400;
  // relief of a map point: elevation range (m) within R metres, from the 50 m DEM
  function relief(X, Y, R) {
    if (!R3.dem) return 0;
    var c0 = Math.max(0, Math.floor((X - R) / 50)), c1 = Math.min(199, Math.ceil((X + R) / 50));
    var r0 = Math.max(0, Math.floor((Y - R) / 50)), r1 = Math.min(99, Math.ceil((Y + R) / 50));
    var lo = 1e9, hi = -1e9;
    for (var r = r0; r <= r1; r++) for (var c = c0; c <= c1; c++) {
      var dx = (c + 0.5) * 50 - X, dy = (r + 0.5) * 50 - Y;
      if (dx * dx + dy * dy > R * R) continue;
      var z = R3.dem[r * 200 + c]; if (z < lo) lo = z; if (z > hi) hi = z;
    }
    return hi - lo;
  }
  function glassSpot() {
    var hm = hero.querySelector(".hero-map"), box = hero.querySelector(".map-box");
    var hb = hm.getBoundingClientRect(), bb = box.getBoundingClientRect(), s0 = bb.width / 10000;
    var pl = hero.querySelector(".hero-place"), pr = pl && pl.getBoundingClientRect();
    var ctl = hero.querySelector(".map-controls"), cr = ctl && ctl.getBoundingClientRect();
    var LRpx = Math.max(hm.clientWidth, hm.clientHeight) * 0.075, cands = [];
    for (var tries = 0, ok = 0; tries < 900 && ok < 70; tries++) {
      var X = 300 + Math.random() * 9400, Y = 300 + Math.random() * 4400;
      var x = bb.left + X * s0, y = bb.top + Y * s0;
      if (x - LRpx < hb.left + 12 || x + LRpx > hb.right - 12 || y - LRpx < hb.top + 12 || y + LRpx > hb.bottom - 12) continue;
      var rx = (x - hb.left) / hb.width, ry = (y - hb.top) / hb.height;
      if (rx < 0.45 && ry > 0.5) continue;                                   // the sentence
      if (pr && x + LRpx > pr.left - 20 && x - LRpx < pr.left + hb.width * 0.17 && Math.abs(y - pr.top) < LRpx + 20) continue;   // town label
      if (cr && y + LRpx > cr.top - 10 && x + LRpx > cr.left - 10) continue; // map controls
      var last = G.last[G.last.length - 1];
      if (last && Math.hypot(x - last[0], y - last[1]) < hb.width * 0.12) continue;   // a new place each time
      ok++;
      cands.push([x, y, relief(X, Y, (LRpx / (1.9 * s0)) * 0.9)]);
    }
    // only real relief: a random pick among spots with >= 75 % of the best range (and >= 100 m)
    var top = cands.reduce(function (m, c) { return Math.max(m, c[2]); }, 0);
    var good = cands.filter(function (c) { return c[2] >= Math.max(100, top * 0.75); });
    var pick = good.length ? good[Math.floor(Math.random() * good.length)] : null;
    return pick ? [pick[0], pick[1]] : [hb.left + hb.width * 0.82, hb.top + hb.height * 0.33];
  }
  function ease(t) { t = Math.min(1, Math.max(0, t)); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function glassStep(now) {
    if (window.scrollY > 30) { R3.lensA = Math.max(0, R3.lensA - 0.08); G.phase = "wait"; G.t0 = now + 500; return; }   // tilt takes over
    var t = now - G.t0;
    if (G.phase === "wait") {
      R3.lensA = 0;
      if (t >= 0) {
        var p = glassSpot(); G.x = p[0]; G.y = p[1];
        G.last.push(p); if (G.last.length > 2) G.last.shift();
        G.phase = "show"; G.t0 = now;
      }
    } else if (G.phase === "show") {
      R3.lensA = ease(t / OPEN) * (1 - ease((t - SHOW + CLOSE) / CLOSE));
      if (t >= SHOW) { G.phase = "wait"; G.t0 = now + PAUSE; R3.lensA = 0; }
    }
    R3.px = G.x; R3.py = G.y; R3.inside = R3.lensA > 0;
  }
  function riseLoop(now) {
    if (!R3 || !CANVAS_MODES[mode]) { if (R3) R3.running = false; return; }
    var t = (now - R3.t0) / 1000;
    if (mode === "intro") {
      R3.k = smooth((t - 0.5) / 2.3) * (1 - smooth((t - 4.6) / 1.9));
      if (t > 6.6) { root.classList.remove("hfx-rising"); R3.canvas.getContext("2d").clearRect(0, 0, R3.canvas.width, R3.canvas.height); R3.running = false; return; }
    } else if (mode === "lens") {
      R3.k = 0;
    } else if (mode === "glass") {
      R3.k = 0;
      glassStep(now);
    } else if (mode === "scroll-rise") {
      // 0 ... 0.7 of the pinned scroll: rise and turn; 0.7 ... 1: push towards the hills
      var pp = pinProgress();
      R3.kT = smooth(pp / 0.7);
      R3.pushT = smooth((pp - 0.7) / 0.3);
      R3.pathP = (R3.pathP || 0) + (Math.min(1, Math.max(0, (pp - 0.5) / 0.38)) - (R3.pathP || 0)) * 0.1;
      R3.k += (R3.kT - R3.k) * 0.1;                       // eased, never jumps with the wheel
      R3.push = (R3.push || 0) + (R3.pushT - (R3.push || 0)) * 0.1;
      cue.classList.toggle("is-gone", pp > 0.015);
      if (R3.k < 1e-3 && R3.kT === 0) R3.k = 0;
      root.classList.toggle("hfx-rising", R3.k > 0.004);
      root.classList.toggle("hfx-risen", R3.k > 0.04);
      // handoff to the background flight: near the end of the pin and while the hero
      // scrolls away, the terraces dissolve and the hero turns transparent, so the
      // flight's ridge lines (fixed behind the page, also looking east) take over
      var hr = hero.getBoundingClientRect(), navH = parseFloat(getComputedStyle(root).getPropertyValue("--nav-h")) || 57;
      var release = Math.min(1, Math.max(0, (navH - hr.top) / (hr.height * 0.55)));
      var fadeT = Math.max(0.55 * smooth((pp - 0.72) / 0.28), smooth(release));
      R3.fade = (R3.fade || 0) + (fadeT - (R3.fade || 0)) * 0.18;
      hero.style.setProperty("--hfx-bg", (1 - R3.fade).toFixed(3));
      R3.canvas.style.opacity = R3.k > 0.004 ? (1 - 0.9 * R3.fade).toFixed(3) : "";   // hidden until it rises
    } else {
      R3.k = smooth((t - 0.7) / 2.6);
    }
    var b = hero.getBoundingClientRect();
    if (b.bottom > 0) drawRise(now);
    requestAnimationFrame(riseLoop);
  }
  hero.addEventListener("pointermove", function (e) {
    if (!R3) return;
    var b = hero.getBoundingClientRect();
    R3.mx = ((e.clientX - b.left) / b.width - 0.5) * 2;
    R3.my = ((e.clientY - b.top) / b.height - 0.5) * 2;
  });
  // scroll cue for scroll-rise: a small mono "scroll" with a falling tick
  var cue = document.createElement("div");
  cue.className = "hfx-cue";
  cue.setAttribute("aria-hidden", "true");
  cue.innerHTML = "<span>" + (de ? "scrollen" : "scroll") + "</span><i></i>";
  hero.appendChild(cue);

  // --------------------------------------------------------------- pinning --
  // scroll-rise: the hero sits in a taller wrapper and sticks under the nav while
  // the scroll inside the wrapper drives the rise (PIN = extra scroll distance).
  var pin = null;
  function pinOn() {
    if (pin) return;
    pin = document.createElement("div");
    pin.className = "hfx-pin";
    hero.parentNode.insertBefore(pin, hero);
    pin.appendChild(hero);
    root.classList.add("hfx-pinned");
  }
  function pinOff() {
    if (!pin) return;
    pin.parentNode.insertBefore(hero, pin);
    pin.remove();
    pin = null;
    root.classList.remove("hfx-pinned", "hfx-risen");
  }
  function pinProgress() {
    if (!pin) return 0;
    var r = pin.getBoundingClientRect(), dist = pin.offsetHeight - hero.offsetHeight;
    return Math.min(1, Math.max(0, -r.top / Math.max(dist, 1)));
  }

  // ------------------------------------------------------------------ play --
  var timers = [];
  function reset() {
    timers.forEach(clearTimeout); timers = [];
    root.classList.remove("hfx-drawing", "hfx-drawn", "hfx-scanning", "hfx-words", "hfx-words-in", "hfx-ul-on", "hfx-light-on", "hfx-rising", "hfx-lens");
    if (R3) R3.ctx.clearRect(0, 0, R3.canvas.width, R3.canvas.height);
    if (mode !== "scroll-rise") { root.classList.remove("hfx-cue-on"); pinOff(); hero.style.removeProperty("--hfx-bg"); if (R3) R3.canvas.style.opacity = ""; }
    if (overlay) overlay.remove(), (overlay = null);
    scanLine.style.left = "";
    hero.style.removeProperty("--scan");
    onScroll();
  }
  function wordsIn(delay) {
    root.classList.add("hfx-words");
    words.forEach(function (w, i) { w.style.transitionDelay = (delay + i * 0.06).toFixed(2) + "s"; });
    timers.push(setTimeout(function () { root.classList.add("hfx-words-in"); }, 30));
  }
  function play() {
    reset();
    if (reduce) return;
    var m = mode;
    if (m === "draw" || m === "draw+accent") {
      buildOverlay();
      root.classList.add("hfx-drawing");
      void overlay.getBoundingClientRect();
      timers.push(setTimeout(function () { root.classList.add("hfx-drawn"); }, 40));
      timers.push(setTimeout(function () {             // hand over to the real map (tools keep working)
        root.classList.remove("hfx-drawing", "hfx-drawn");
        if (overlay) overlay.remove(), (overlay = null);
      }, 3400));
      wordsIn(1.6);
      if (m === "draw+accent") timers.push(setTimeout(function () { root.classList.add("hfx-ul-on"); }, 3100));
    } else if (m === "scan") {
      root.classList.add("hfx-scanning");
      var t0 = performance.now();
      (function step(now) {
        var t = (now - t0) / 2400, x = -6 + 112 * smooth(t);
        hero.style.setProperty("--scan", x.toFixed(2) + "%");
        if (t < 1) requestAnimationFrame(step);
        else root.classList.remove("hfx-scanning");
      })(t0);
      wordsIn(1.4);
    } else if (m === "accent") {
      timers.push(setTimeout(function () { root.classList.add("hfx-ul-on"); }, 400));
    } else if (CANVAS_MODES[m]) {
      buildRise().then(function () {
        if (m === "sun") R3.sun = sunNow();
        if (m !== "scroll-rise" && m !== "lens" && m !== "glass") root.classList.add("hfx-rising");
        if (m === "scroll-rise") { pinOn(); R3.k = 0; R3.push = 0; root.classList.add("hfx-cue-on"); }
        root.classList.toggle("hfx-lens", m === "lens" || m === "glass");
        if (m === "glass") { G.phase = "wait"; G.t0 = performance.now() + 1000; G.last = []; R3.inside = false; R3.lensA = 0; }
        R3.t0 = performance.now();
        if (!R3.running) { R3.running = true; requestAnimationFrame(riseLoop); }
      });
      if (m === "rise" || m === "sun" || m === "intro") wordsIn(m === "intro" ? 1.6 : 2.4);
    } else if (m === "light") {
      buildLight(); paintLight();
      root.classList.add("hfx-light-on");
    }
    onScroll();
  }

  // ---------------------------------------------------------------- picker --
  var picker = document.createElement("div");
  picker.className = "orbit-picker hfx-picker";
  picker.setAttribute("role", "group");
  picker.setAttribute("aria-label", LABEL.title);
  picker.innerHTML = "<span>" + LABEL.title + "</span>" + MODES.map(function (m) {
    return '<button type="button" data-hero="' + m + '">' + LABEL[m] + "</button>";
  }).join("") + '<button type="button" data-replay>' + LABEL.replay + "</button>";
  function syncPicker() {
    picker.querySelectorAll("[data-hero]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.hero === mode)); });
  }
  picker.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.hero) { mode = b.dataset.hero; try { localStorage.setItem("hero-preview", mode); } catch (err) {} }
    syncPicker();
    if (window.scrollY > 10 && mode !== "tilt") window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    play();
  });
  document.body.appendChild(picker);
  syncPicker();
  play();
})();

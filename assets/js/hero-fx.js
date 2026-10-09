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
//   scroll-rise  the map rises as you scroll, then leans away into the flight
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
  var MODES = ["intro", "tilt", "sun", "lens", "scroll-rise", "rise", "scan", "light", "none"];
  var LABEL = de
    ? { title: "Startbereich (Vorschau)", intro: "intro", sun: "sonne", lens: "lupe", "scroll-rise": "scroll-3d", rise: "aufsteigen", none: "ohne", draw: "zeichnen", scan: "scan", tilt: "kippen", light: "licht", accent: "akzent", "draw+accent": "zeichnen+akzent", replay: "wiederholen ↺" }
    : { title: "Hero (preview)", intro: "intro", sun: "sun", lens: "lens", "scroll-rise": "scroll-3d", rise: "rise", none: "none", draw: "draw", scan: "scan", tilt: "tilt", light: "light", accent: "accent", "draw+accent": "draw+accent", replay: "replay ↺" };

  var mode = new URLSearchParams(location.search).get("hero");
  if (MODES.indexOf(mode) < 0) { try { mode = localStorage.getItem("hero-preview"); } catch (e) {} }
  if (MODES.indexOf(mode) < 0) mode = "intro";
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
    var p = mode === "tilt" ? Math.min(1, Math.max(0, window.scrollY / (hero.offsetHeight * 0.9))) : 0;
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
    return fetch(hero.dataset.topo + "hero-terraces.json").then(function (r) { return r.json(); }).then(function (d) {
      R3.levels = d.levels.map(function (l) { return { z: l.z - d.zmin, index: l.z % 50 === 0, rings: l.rings }; });
      var pl = hero.querySelector(".hero-place");
      if (pl) {   // the town label's map position (build_hero.py) on the lowest terrace
        var fx = parseFloat(pl.style.getPropertyValue("--fx")), fy = parseFloat(pl.style.getPropertyValue("--fy"));
        R3.place = [fx * 10000, fy * 5000, 30];
      }
      return R3;
    });
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
    var lens = mode === "lens";
    if (mode === "scroll-rise") scrollP = Math.max(0, (window.scrollY - hero.offsetHeight * 0.35) / (hero.offsetHeight * 0.6));
    R3.mxs += (R3.mx - R3.mxs) * 0.05; R3.mys += (R3.my - R3.mys) * 0.05;
    R3.lensA += ((R3.inside ? 1 : 0) - R3.lensA) * 0.12;
    var lx = (R3.px || 0) - (hb.left), ly = (R3.py || 0) - (hb.top), LR = Math.max(W, H) * 0.12;
    var sway = Math.sin(time / 4200);
    var tilt = (k * TILT + scrollP * 14 + R3.mys * 4 * k) * Math.PI / 180;   // 0 = straight down
    var yaw = (k * (YAW + sway * 2.5) + R3.mxs * 8 * k) * Math.PI / 180;
    var s = s0 * (1 + k * ZOOM);                       // zoom in a little as the view tilts
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
      var LS = s0 * 1.6, LT = 48 * Math.PI / 180, lct = Math.cos(LT), lst = Math.sin(LT);
      var mX = (lx - ox) / s0, mY = (ly - oy) / s0, LD = LR * 6;
      ex = EXAG * LS * 0.8;
      var zc = 0;                                             // ground height under the pointer (nearest terrace)
      for (var q = 0; q < R3.levels.length; q++) { if (R3.levels[q].z * ex > zc && inLevel(R3.levels[q], mX, mY)) zc = R3.levels[q].z * ex; }
      proj = function (X, Y, Z, o) {
        var x = (X - mX) * LS, y = (Y - mY) * LS;            // oblique parallel view: no distortion
        o[0] = lx + x;
        o[1] = ly + LR * 0.3 + y * lct - (Z - zc) * lst;
      };
      ctx.save();
      ctx.beginPath(); ctx.arc(lx, ly, LR * R3.lensA, 0, Math.PI * 2); ctx.clip();
      ctx.globalAlpha = 1; ctx.fillStyle = paper; ctx.fillRect(lx - LR, ly - LR, LR * 2, LR * 2);
    }
    // sun: shadow offset (screen px per 10 m terrace step), from the real sun position
    var shadow = null;
    if (mode === "sun" && R3.sun && R3.sun.alt > 1 && k > 0.01) {
      var len = Math.min(320, (10 * EXAG) / Math.tan(R3.sun.alt * Math.PI / 180));   // map metres
      var az = R3.sun.az * Math.PI / 180, ddx = -Math.sin(az) * len, ddy = Math.cos(az) * len;
      var a0 = [0, 0], a1 = [0, 0];
      proj(5000, 2500, 0, a0); proj(5000 + ddx, 2500 + ddy, 0, a1);
      shadow = [(a1[0] - a0[0]) * k, (a1[1] - a0[1]) * k];
    }
    var isDark = css.getPropertyValue("--paper").trim().toLowerCase() === "#0e1215";
    var o = [0, 0];
    var lv = R3.levels;
    for (var n = 0; n < lv.length; n++) {
      var L = lv[n], Z = L.z * ex;
      // fill: the whole layer; stroke: only the contour, not the map border
      var fillPath = new Path2D(), linePath = new Path2D();
      for (var r = 0; r < L.rings.length; r++) {
        var ring = L.rings[r], pen = false, prevEdge = false;
        for (var i = 0; i < ring.length; i += 2) {
          var X = ring[i], Y = ring[i + 1];
          var edge = X <= 15 || X >= 9985 || Y <= 15 || Y >= 4985;
          proj(X, Y, Z, o);
          if (i) fillPath.lineTo(o[0], o[1]); else fillPath.moveTo(o[0], o[1]);
          if (pen && !(edge && prevEdge)) linePath.lineTo(o[0], o[1]); else linePath.moveTo(o[0], o[1]);
          pen = true; prevEdge = edge;
        }
        fillPath.closePath();
      }
      if (shadow) {                                          // cast shadow onto the layer below
        ctx.save();
        ctx.translate(shadow[0], shadow[1]);
        ctx.globalAlpha = isDark ? 0.55 : 0.09;
        ctx.fillStyle = "#000";
        ctx.fill(fillPath, "evenodd");
        ctx.restore();
        ctx.fillStyle = paper;
      }
      if (k > 0.001 || lens) { ctx.globalAlpha = lens ? 1 : Math.min(1, k * 3); ctx.fillStyle = paper; ctx.fill(fillPath, "evenodd"); }
      ctx.globalAlpha = L.index ? 0.85 : 0.45;
      ctx.lineWidth = L.index ? 1.2 : 0.6;
      ctx.stroke(linePath);
    }
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
    R3.px = e.clientX; R3.py = e.clientY; R3.inside = true;
  });
  hero.addEventListener("pointerleave", function () { if (R3) R3.inside = false; });

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
  var CANVAS_MODES = { rise: 1, intro: 1, sun: 1, lens: 1, "scroll-rise": 1 };
  function riseLoop(now) {
    if (!R3 || !CANVAS_MODES[mode]) { if (R3) R3.running = false; return; }
    var t = (now - R3.t0) / 1000;
    if (mode === "intro") {
      R3.k = smooth((t - 0.5) / 2.3) * (1 - smooth((t - 4.6) / 1.9));
      if (t > 6.6) { root.classList.remove("hfx-rising"); R3.canvas.getContext("2d").clearRect(0, 0, R3.canvas.width, R3.canvas.height); R3.running = false; return; }
    } else if (mode === "lens") {
      R3.k = 0;
    } else if (mode === "scroll-rise") {
      R3.k = smooth(window.scrollY / (hero.offsetHeight * 0.45));
      root.classList.toggle("hfx-rising", R3.k > 0.005);
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
  // ------------------------------------------------------------------ play --
  var timers = [];
  function reset() {
    timers.forEach(clearTimeout); timers = [];
    root.classList.remove("hfx-drawing", "hfx-drawn", "hfx-scanning", "hfx-words", "hfx-words-in", "hfx-ul-on", "hfx-light-on", "hfx-rising", "hfx-lens");
    if (R3) R3.ctx.clearRect(0, 0, R3.canvas.width, R3.canvas.height);
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
        if (m !== "scroll-rise" && m !== "lens") root.classList.add("hfx-rising");
        root.classList.toggle("hfx-lens", m === "lens");
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

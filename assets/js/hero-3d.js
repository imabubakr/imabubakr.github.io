// Hero: the contour map rises into 3D as you scroll, then blows away like sand into
// the flight background below.
//
// The hero sits in a taller wrapper (.hero-pin) and sticks under the nav while the
// scroll inside the wrapper drives one sequence (pinned progress pp 0..1):
//   0    - 0.15  the sentence lifts away
//   0    - 0.5   the flat map lifts into stacked paper terraces, one per 10 m level
//                (assets/topo/hero-terraces.json, tools/hero/build_terraces.py), and the
//                view turns east into the Black Forest; height labels on the 50 m
//                levels and trig points on the three highest summits fade in
//   0.28 - 0.6   a scan band passes across the model (accent, occlusion-aware)
//   0.45 - 0.8   the camera pushes in a little
//   0.6  - 1     the paper model gives way to points that blow away like sand while
//                the hero's paper turns transparent, so the background flight
//                (backdrop.js, also looking east) takes over before the hero leaves
// All values ease towards their targets, so the wheel never makes it jump. While
// risen, the map tools, controls and strip ticks step back. Reduced motion: none of
// this; the flat hero stays as it is.
(function () {
  var root = document.documentElement;
  var hero = document.querySelector(".hero");
  if (!hero || !hero.querySelector("svg.topo")) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var de = root.lang === "de";
  var hm = hero.querySelector(".hero-map"), box = hero.querySelector(".map-box");
  var smooth = function (t) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
  var clamp01 = function (t) { return Math.min(1, Math.max(0, t)); };

  // view: tilt from straight down (deg), turn (deg), zoom, height exaggeration, lift
  var TILT = 66, YAW = -80, ZOOM = 1.25, EXAG = 3.6, LIFT = 0.55;

  // ---------------------------------------------------------------- pin + cue --
  var pin = document.createElement("div");
  pin.className = "hero-pin";
  hero.parentNode.insertBefore(pin, hero);
  pin.appendChild(hero);
  root.classList.add("hero-pinned");
  function pinProgress() {
    var r = pin.getBoundingClientRect(), dist = pin.offsetHeight - hero.offsetHeight;
    return clamp01(-r.top / Math.max(dist, 1));
  }
  var cue = document.createElement("div");
  cue.className = "hero-cue";
  cue.setAttribute("aria-hidden", "true");
  cue.innerHTML = "<span>" + (de ? "scrollen" : "scroll") + "</span><i></i>";
  hero.appendChild(cue);

  var cv = document.createElement("canvas");
  cv.className = "hero-3d";
  cv.setAttribute("aria-hidden", "true");
  hm.appendChild(cv);
  var ctx = cv.getContext("2d");

  var S = { k: 0, push: 0, sweep: 0, fade: 0, levels: null, dem: null, zmin: 0, trig: null };

  // -------------------------------------------------------------------- data --
  fetch(hero.dataset.topo + "hero-contours-dem.bin").then(function (r) { return r.arrayBuffer(); })
    .then(function (buf) { S.dem = new Int16Array(buf); S.trig = findTrig(); });      // 200 x 100 cells of 50 m
  fetch(hero.dataset.topo + "hero-terraces.json").then(function (r) { return r.json(); }).then(function (d) {
    S.zmin = d.zmin;
    S.levels = d.levels.map(function (l) { return { z: l.z - d.zmin, elev: l.z, index: l.z % 50 === 0, rings: l.rings }; });
    // label anchor per 50 m level: its westernmost vertex (facing the camera), off the map border
    S.levels.forEach(function (L) {
      if (!L.index) return;
      var best = null;
      L.rings.forEach(function (g) {
        for (var i = 0; i < g.length; i += 2) {
          if (g[i] < 400 || g[i] > 9600 || g[i + 1] < 400 || g[i + 1] > 4600) continue;
          if (!best || g[i] < best[0]) best = [g[i], g[i + 1]];
        }
      });
      L.anchor = best;
    });
    requestAnimationFrame(loop);
  });

  // the three highest summits (DEM local maxima, >= 1.5 km apart)
  function findTrig() {
    var d = S.dem, peaks = [], out = [];
    for (var r = 3; r < 97; r++) for (var c = 3; c < 197; c++) {
      var z = d[r * 200 + c], top = true;
      for (var dr = -3; dr <= 3 && top; dr++) for (var dc = -3; dc <= 3; dc++) if (d[(r + dr) * 200 + c + dc] > z) { top = false; break; }
      if (top) peaks.push([(c + 0.5) * 50, (r + 0.5) * 50, z]);
    }
    peaks.sort(function (a, b) { return b[2] - a[2]; });
    peaks.forEach(function (p) {
      if (out.length < 3 && out.every(function (q) { return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1500; })) out.push(p);
    });
    return out;
  }
  function mixColor(a, b, t) {                               // two #rrggbb colours
    var pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16), o = [];
    for (var sh = 16; sh >= 0; sh -= 8) o.push(Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t));
    return "rgb(" + o.join(",") + ")";
  }

  // ------------------------------------------------------------------- draw --
  function draw() {
    var W = hm.clientWidth, H = hm.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    var hb = hm.getBoundingClientRect(), bb = box.getBoundingClientRect();
    var s0 = bb.width / 10000, ox = bb.left - hb.left, oy = bb.top - hb.top;   // flat map: px = ox + x * s0
    var k = S.k, push = S.push;
    var tilt = (k * TILT + push * 4) * Math.PI / 180, yaw = (k * YAW + push * 10) * Math.PI / 180;
    var s = s0 * (1 + k * ZOOM + push * 0.3), ex = k * EXAG * s;
    var ct = Math.cos(tilt), st = Math.sin(tilt), cyw = Math.cos(yaw), syw = Math.sin(yaw);
    var D = Math.max(W, H) * 1.6, pcx = ox + 5000 * s0, pcy = oy + 2500 * s0 + k * H * LIFT;
    var proj = function (X, Y, Z, o) {
      var x = (X - 5000) * s, y = (Y - 2500) * s;
      var xr = x * cyw - y * syw, yr = x * syw + y * cyw;      // turn about the map centre
      var f = D / (D - yr * st);                              // the far side is smaller
      o[0] = pcx + xr * f;
      o[1] = pcy + (yr * ct - Z * st) * f;
    };
    var css = getComputedStyle(root);
    var paper = css.getPropertyValue("--paper").trim(), line = css.getPropertyValue("--contour").trim();
    var isDark = paper.toLowerCase() === "#0e1215";
    var accent = css.getPropertyValue("--accent-mark").trim();
    var labelCol = css.getPropertyValue(isDark ? "--muted" : "--contour").trim();
    var edgeCol = mixColor(paper, line, isDark ? 0.3 : 0.22);
    var fade = S.fade, solid = 1 - Math.min(1, fade * 3);
    var labelA = smooth((k - 0.45) / 0.4) * (1 - Math.min(1, fade * 2.5));
    var o = [0, 0], tmp = [0, 0], tmp2 = [0, 0], placed = [];
    proj(5000, 2500, 0, tmp); proj(5000, 2500, 10 * ex, tmp2);
    var thick = Math.min(1.8, Math.max(0, tmp[1] - tmp2[1]));        // a fine card edge per layer
    proj(5000, -2000, 0, tmp); var yFar = tmp[1]; proj(5000, 7000, 0, tmp); var yNear = tmp[1];

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineJoin = "round";
    var lv = S.levels;
    for (var n = 0; n < lv.length; n++) {
      var L = lv[n], Z = L.z * ex;
      // fill: the whole layer; line: only the contour, not the map border
      var fillPath = new Path2D(), linePath = new Path2D();
      for (var r = 0; r < L.rings.length; r++) {
        var ring = L.rings[r], pen = false, prevEdge = false;
        for (var i = 0; i < ring.length; i += 2) {
          var X = ring[i], Y = ring[i + 1], edge = X <= 15 || X >= 9985 || Y <= 15 || Y >= 4985;
          proj(X, Y, Z, o);
          if (i) fillPath.lineTo(o[0], o[1]); else fillPath.moveTo(o[0], o[1]);
          if (pen && !(edge && prevEdge)) linePath.lineTo(o[0], o[1]); else linePath.moveTo(o[0], o[1]);
          pen = true; prevEdge = edge;
        }
        fillPath.closePath();
      }
      if (thick > 0.6 && n > 0 && solid > 0.01) {             // the card's edge, under the layer
        ctx.save(); ctx.translate(0, thick); ctx.globalAlpha = Math.min(1, k * 1.5) * solid;
        ctx.fillStyle = edgeCol; ctx.fill(fillPath, "evenodd"); ctx.restore();
      }
      if (solid > 0.01) { ctx.globalAlpha = solid; ctx.fillStyle = paper; ctx.fill(fillPath, "evenodd"); }
      // atmospheric depth: far lines recede
      var a = L.index ? 0.85 : 0.45, cy0 = 0, cnt = 0, rr0 = L.rings[0];
      for (var q = 1; q < rr0.length; q += 16) { proj(rr0[q - 1], rr0[q], Z, tmp); cy0 += tmp[1]; cnt++; }
      if (cnt) a *= 1 - 0.45 * k * clamp01((yNear - cy0 / cnt) / Math.max(1, yNear - yFar));
      ctx.globalAlpha = a * (1 - Math.min(1, fade * 3));
      ctx.strokeStyle = line;
      ctx.lineWidth = L.index ? 1.2 : 0.6;
      ctx.stroke(linePath);
      if (fade > 0.01) drawSand(L, Z, proj, fade, line, W);
      if (S.sweep > 0 && S.sweep < 1) drawSweep(linePath, Z, proj, accent);
      if (L.index && L.anchor && labelA > 0.01) {             // height label on the 50 m levels
        proj(L.anchor[0], L.anchor[1], Z, tmp);
        var lx = tmp[0], ly = tmp[1], clear = lx > 30 && lx < W - 60 && ly > 24 && ly < H - 24 &&
          !(lx < W * 0.42 && ly > H * 0.6);                     // not over the sentence
        for (var u = 0; u < placed.length && clear; u++) if (Math.abs(placed[u][0] - lx) < 64 && Math.abs(placed[u][1] - ly) < 18) clear = false;
        if (clear) {
          placed.push([lx, ly]);
          monoLabel(L.elev + " m", lx - 6, ly + 3.5, "right", labelA, labelCol, paper);
          ctx.fillRect(lx - 3, ly - 0.5, 3, 1);
        }
      }
    }
    if (S.trig && labelA > 0.01) drawTrig(proj, ex, labelA, css, paper);
    ctx.globalAlpha = 1;
  }
  function monoLabel(t, x, y, align, alpha, fill, halo) {
    ctx.globalAlpha = alpha;
    ctx.font = '500 10px "IBM Plex Mono", monospace';
    if ("letterSpacing" in ctx) ctx.letterSpacing = "1px";
    ctx.textAlign = align;
    ctx.lineWidth = 3; ctx.strokeStyle = halo; ctx.lineJoin = "round";
    ctx.strokeText(t, x, y);
    ctx.fillStyle = fill; ctx.fillText(t, x, y);
    ctx.textAlign = "left";
  }
  // scan band west -> east, clipped per layer so higher layers still hide it
  function drawSweep(linePath, Z, proj, accent) {
    var Xs = 3800 + S.sweep * 6400, t = [0, 0];
    [[260, 0.28, 1.2], [70, 0.95, 1.5]].forEach(function (b) {
      ctx.save(); ctx.beginPath();
      [[Xs - b[0], -500], [Xs + b[0], -500], [Xs + b[0], 5500], [Xs - b[0], 5500]].forEach(function (q, i) {
        proj(q[0], q[1], Z, t); if (i) ctx.lineTo(t[0], t[1]); else ctx.moveTo(t[0], t[1]);
      });
      ctx.closePath(); ctx.clip();
      ctx.strokeStyle = accent; ctx.globalAlpha = b[1] * Math.sin(Math.PI * S.sweep); ctx.lineWidth = b[2];
      ctx.stroke(linePath); ctx.restore();
    });
  }
  // the layer as fine points (like a LiDAR cloud), then blown away like sand: a gust from
  // left to right; each grain accelerates up and downwind with its own speed and fades
  // Grains are batched into 8 transparency levels and filled once per level per layer
  // (thousands of single fillRect calls with changing alpha dropped frames).
  var NB = 8;
  function drawSand(L, Z, proj, dis, col, W) {
    var o = [0, 0], appear = Math.min(1, dis * 5), base = L.index ? 0.9 : 0.6, sz0 = L.index ? 2 : 1.6;
    var step = L.index ? 30 : 40, buckets = [];
    for (var bi = 0; bi < NB; bi++) buckets.push(new Path2D());
    for (var r = 0; r < L.rings.length; r++) {
      var g = L.rings[r];
      for (var i = 0; i < g.length - 2; i += 2) {
        var X0 = g[i], Y0 = g[i + 1], X1 = g[i + 2], Y1 = g[i + 3];
        var n = Math.max(1, Math.round(Math.hypot(X1 - X0, Y1 - Y0) / step));
        for (var j = 0; j < n; j++) {
          var h = Math.sin((X0 * 12.9898 + Y0 * 78.233 + j * 37.7) * 0.01) * 43758.5453; h -= Math.floor(h);
          var h2 = Math.sin((X0 * 3.17 + Y0 * 9.31 + j * 11.1) * 0.01) * 24634.6345; h2 -= Math.floor(h2);
          var h3 = Math.sin((X0 * 7.7 + Y0 * 1.3 + j * 5.3) * 0.01) * 15731.743; h3 -= Math.floor(h3);
          proj(X0 + (X1 - X0) * j / n, Y0 + (Y1 - Y0) * j / n, Z, o);
          var lp = clamp01((dis - 0.22 - 0.3 * (o[0] / W) - 0.18 * h3) / 0.42);
          if (lp >= 1) continue;
          var e = lp * lp, sz = sz0 * (1 - 0.5 * lp);
          buckets[Math.min(NB - 1, Math.floor(lp * NB))].rect(
            o[0] + (h - 0.5) * 8 * appear + e * (90 + 220 * h),
            o[1] + (h2 - 0.4) * 8 * appear - e * (60 + 260 * h2) + Math.sin(lp * 6 + h * 6) * 6 * lp, sz, sz);
        }
      }
    }
    ctx.fillStyle = col;
    for (var k = 0; k < NB; k++) {
      ctx.globalAlpha = base * appear * (1 - (k + 0.5) / NB);
      ctx.fill(buckets[k]);
    }
  }
  // survey control points: trig triangles with their height
  function drawTrig(proj, ex, A, css, paper) {
    var o = [0, 0], ink = css.getPropertyValue("--ink").trim();
    S.trig.forEach(function (p) {
      proj(p[0], p[1], (p[2] - S.zmin) * ex, o);
      var x = o[0], y = o[1] - 2;
      ctx.globalAlpha = A;
      ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 6, y + 3.5); ctx.lineTo(x - 6, y + 3.5); ctx.closePath();
      ctx.fillStyle = paper; ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = 1.3; ctx.stroke();
      ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(x, y - 0.5, 1.4, 0, Math.PI * 2); ctx.fill();
      monoLabel(Math.round(p[2]) + " m", x + 10, y + 2, "left", A, ink, paper);
    });
  }

  // ------------------------------------------------------------------- loop --
  var navH = function () { return parseFloat(getComputedStyle(root).getPropertyValue("--nav-h")) || 57; };
  function loop() {
    var pp = pinProgress();
    var ease = function (key, target, rate) { S[key] += (target - S[key]) * rate; };
    ease("k", smooth(pp / 0.5), 0.1);
    ease("push", smooth((pp - 0.45) / 0.35), 0.1);
    ease("sweep", clamp01((pp - 0.28) / 0.32), 0.12);
    var hr = hero.getBoundingClientRect();
    var release = clamp01((navH() - hr.top) / (hr.height * 0.55));
    ease("fade", Math.max(smooth((pp - 0.6) / 0.4), smooth(release)), 0.14);
    if (S.k < 1e-3 && pp === 0) S.k = 0;
    cue.classList.toggle("is-gone", pp > 0.015);
    root.classList.toggle("hero-rising", S.k > 0.004);
    root.classList.toggle("hero-risen", S.k > 0.04);
    hero.style.setProperty("--hero-bg", (1 - S.fade).toFixed(3));
    hero.style.setProperty("--hero-flat", (1 - smooth(S.k / 0.3)).toFixed(3));
    cv.style.opacity = S.k > 0.004 ? (1 - 0.15 * S.fade).toFixed(3) : "";
    if (S.k > 0.004 && hr.bottom > 0) draw();
    requestAnimationFrame(loop);
  }
})();

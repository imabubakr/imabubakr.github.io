// Page background: a low flight over the Black Forest. Ridge lines of the region
// DEM, drawn in perspective on a fixed canvas behind the page. Scrolling flies the
// route Freiburg -> Schauinsland -> Feldberg; the page bottom ends looking at the
// Feldberg summit. The camera eases towards the scroll position (no jumps), near
// ridges are drawn stronger than far ones, and the flight steps back while
// section [02] (its own descent) is on screen. Reduced motion: one still frame.
// Data: assets/topo/region-contours.{json,dem.bin} (400 x 360 cells of 100 m,
// x east, y south, row 0 = north).
(function () {
  var root = document.documentElement;
  var hero = document.querySelector("[data-topo]");
  var base = hero ? hero.getAttribute("data-topo") : "assets/topo/";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  var orbit = document.getElementById("orbit");

  // Route in region metres: west of Freiburg, Freiburg, Schauinsland, Feldberg.
  var ROUTE = [[17500, 16800], [23143, 18541], [26450, 27850], [34350, 32250]];
  var LOOK = 1500;          // heading = direction to the route point this far ahead (m)
  var END_GAP = 5000;       // the flight stops this far before the last point
  var EX = 2.6, H0 = 170;   // vertical exaggeration, base level (m)
  var NEAR = 300, FAR = 12000, STEP = 200;

  var canvas = document.createElement("canvas");
  canvas.className = "backdrop";
  canvas.setAttribute("aria-hidden", "true");
  var ctx = canvas.getContext("2d");
  var w = 0, h = 0, dpr = 1;
  var dem = null, meta = null;
  var route = null;                // sampled route: [{x, y, s}]
  var cur = null, curZ = null;     // eased distance along the route and camera height
  var last = 0, running = false;

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

  // Catmull-Rom through ROUTE, sampled every ~50 m with distance along it.
  function buildRoute() {
    var P = [ROUTE[0]].concat(ROUTE, [ROUTE[ROUTE.length - 1]]), out = [], s = 0;
    for (var i = 1; i < P.length - 2; i++) {
      var p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
      var n = Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 50);
      for (var k = 0; k < n; k++) {
        var t = k / n, t2 = t * t, t3 = t2 * t;
        var pt = [0, 1].map(function (j) {
          return 0.5 * (2 * p1[j] + (p2[j] - p0[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 +
            (3 * p1[j] - p0[j] - 3 * p2[j] + p3[j]) * t3);
        });
        if (out.length) s += Math.hypot(pt[0] - out[out.length - 1].x, pt[1] - out[out.length - 1].y);
        out.push({ x: pt[0], y: pt[1], s: s });
      }
    }
    var end = ROUTE[ROUTE.length - 1];
    s += Math.hypot(end[0] - out[out.length - 1].x, end[1] - out[out.length - 1].y);
    out.push({ x: end[0], y: end[1], s: s });
    return out;
  }
  function at(s) {
    s = Math.min(Math.max(s, 0), route[route.length - 1].s);
    var lo = 0, hi = route.length - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (route[mid].s <= s) lo = mid;
      else hi = mid;
    }
    var a = route[lo], b = route[hi], t = (s - a.s) / (b.s - a.s || 1);
    return [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t];
  }

  // ---------------------------------------------------------- helpers --
  function color(name) { return getComputedStyle(root).getPropertyValue(name).trim(); }
  function target() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var p = reduce.matches ? 0.35 : Math.min(Math.max(window.scrollY / (max || 1), 0), 1);
    return p * (route[route.length - 1].s - END_GAP);
  }
  // camera height: ~450 m (exaggerated) above the highest ground in the next 6 km
  function targetZ(s) {
    var c = at(s), a = at(s + LOOK), len = Math.hypot(a[0] - c[0], a[1] - c[1]) || 1;
    var ux = (a[0] - c[0]) / len, uy = (a[1] - c[1]) / len, hi = 0;
    for (var d = 0; d <= 6000; d += 250) hi = Math.max(hi, elev(c[0] + ux * d, c[1] + uy * d));
    return (hi - H0) * EX + 450;
  }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  function orbitShare() {
    if (!orbit) return 0;
    var r = orbit.getBoundingClientRect();
    return Math.max(0, Math.min(r.bottom, h) - Math.max(r.top, 0)) / h;
  }

  // ------------------------------------------------------------- draw --
  function draw(s, camZ) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var c = at(s), a = at(s + LOOK), len = Math.hypot(a[0] - c[0], a[1] - c[1]) || 1;
    var ux = (a[0] - c[0]) / len, uy = (a[1] - c[1]) / len; // heading
    var rx = -uy, ry = ux;                                  // to the right on screen
    var f = Math.max(w, h) * 0.55, horizon = h * 0.34;
    var paper = color("--paper"), line = color("--contour");
    var dx = w < 600 ? 6 : 4;
    ctx.lineJoin = "round";
    ctx.strokeStyle = line;
    ctx.fillStyle = paper;
    // lines sit at fixed distances along the way, so they glide towards the viewer
    for (var k = Math.floor((s + FAR) / STEP); k * STEP > s + NEAR; k--) {
      var d = k * STEP - s;
      var near = 1 - (d - NEAR) / (FAR - NEAR);          // 1 near ... 0 far
      // far away only every second line; the others fade in between 7 and 5 km
      var thin = k % 2 ? Math.min(1, Math.max(0, (7000 - d) / 2000)) : 1;
      var alpha = Math.pow(near, 1.6) * thin;
      if (alpha < 0.03) continue;
      var cx = c[0] + ux * d, cy = c[1] + uy * d, top = Infinity;
      ctx.beginPath();
      for (var sx = -dx; sx <= w + dx; sx += dx) {
        var l = ((sx - w / 2) / f) * d;
        var z = (elev(cx + rx * l, cy + ry * l) - H0) * EX;
        var sy = horizon + (f * (camZ - z)) / d;
        if (sy < top) top = sy;
        if (sx < 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      if (top > h + 2) continue;
      ctx.lineTo(w + dx, h + 4);
      ctx.lineTo(-dx, h + 4);
      ctx.closePath();
      ctx.globalAlpha = 1;
      ctx.fill();
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 0.6 + 1.1 * near * near;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    canvas.style.setProperty("--fade", String(1 - 0.85 * orbitShare()));
  }

  // Ease towards the scroll position (time constant ~0.35 s), then stop the loop.
  function frame(now) {
    var dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    var goal = target(), goalZ = targetZ(cur);
    var k = reduce.matches ? 1 : 1 - Math.exp(-dt / 0.35);
    cur += (goal - cur) * k;
    curZ += (goalZ - curZ) * (reduce.matches ? 1 : 1 - Math.exp(-dt / 0.6));
    draw(cur, curZ);
    if (Math.abs(goal - cur) > 1 || Math.abs(goalZ - curZ) > 1) requestAnimationFrame(frame);
    else running = false;
  }
  function kick() {
    if (running || !route) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }

  function start() {
    fetch(base + "region-contours.json")
      .then(function (r) { return r.json(); })
      .then(function (m) {
        meta = m;
        return fetch(base + m.grid.file).then(function (r) { return r.arrayBuffer(); });
      })
      .then(function (buf) {
        dem = new Int16Array(buf);
        route = buildRoute();
        cur = target();
        curZ = targetZ(cur);
        document.body.insertBefore(canvas, document.body.firstChild);
        resize();
        draw(cur, curZ);
        window.addEventListener("resize", function () { resize(); draw(cur, curZ); });
        window.addEventListener("scroll", function () { if (!reduce.matches) kick(); }, { passive: true });
        var redraw = function () { draw(cur, curZ); };
        new MutationObserver(redraw).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
      })
      .catch(function () {});
  }
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start);
})();

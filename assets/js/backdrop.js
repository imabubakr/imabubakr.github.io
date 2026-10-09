// Page background, preview of three candidates next to the current one (owner is
// comparing them, 2026-10-09). A switcher bottom-left picks one; ?bg=<mode> also works.
//   village   current: building outlines of Ebringen (CSS body::before, site.css)
//   flight    ridge lines of the Freiburg region in perspective; scrolling flies east
//             from the Rhine plain into the Black Forest (fades out over section [02])
//   parallax  top-down ridge lines of the region that move slower than the page
//   path      village outlines + a drone survey line that draws itself as you scroll
// Data: assets/topo/region-contours.{json,dem.bin} (400 x 360 cells of 100 m, row 0 = north).
// Reduced motion: one still frame, no scroll updates.
(function () {
  var root = document.documentElement;
  var MODES = ["village", "flight", "parallax", "path"];
  var de = root.lang === "de";
  var hero = document.querySelector("[data-topo]");
  var base = hero ? hero.getAttribute("data-topo") : "assets/topo/";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  var mode = new URLSearchParams(location.search).get("bg");
  if (MODES.indexOf(mode) < 0) {
    try { mode = localStorage.getItem("bg-preview"); } catch (e) {}
  }
  if (MODES.indexOf(mode) < 0) mode = "village";

  var canvas = document.createElement("canvas");
  canvas.className = "backdrop";
  canvas.setAttribute("aria-hidden", "true");
  var ctx = canvas.getContext("2d");
  var w = 0, h = 0, dpr = 1, queued = false;
  var dem = null, meta = null, demLoading = null;
  var orbit = document.getElementById("orbit");

  // ------------------------------------------------------------- data --
  function loadDem() {
    if (!demLoading) {
      demLoading = fetch(base + "region-contours.json")
        .then(function (r) { return r.json(); })
        .then(function (m) {
          meta = m;
          return fetch(base + m.grid.file).then(function (r) { return r.arrayBuffer(); });
        })
        .then(function (buf) { dem = new Int16Array(buf); });
    }
    return demLoading;
  }
  // bilinear elevation (m) at region coordinates x (east) / y (south) in metres
  function elev(x, y) {
    var g = meta.grid;
    var fx = Math.min(Math.max(x / g.cell_m[0] - 0.5, 0), g.cols - 1.001);
    var fy = Math.min(Math.max(y / g.cell_m[1] - 0.5, 0), g.rows - 1.001);
    var c = Math.floor(fx), r = Math.floor(fy), tx = fx - c, ty = fy - r, i = r * g.cols + c;
    var a = dem[i] + (dem[i + 1] - dem[i]) * tx;
    var b = dem[i + g.cols] + (dem[i + g.cols + 1] - dem[i + g.cols]) * tx;
    return a + (b - a) * ty;
  }

  // ---------------------------------------------------------- helpers --
  function color(name) { return getComputedStyle(root).getPropertyValue(name).trim(); }
  function progress() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    return reduce.matches ? 0.35 : Math.min(Math.max(window.scrollY / (max || 1), 0), 1);
  }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  // section [02] has its own flight: the flight background steps back while it is on screen
  function orbitShare() {
    if (!orbit) return 0;
    var r = orbit.getBoundingClientRect();
    return Math.max(0, Math.min(r.bottom, h) - Math.max(r.top, 0)) / h;
  }

  // ----------------------------------------------------------- flight --
  function drawFlight(p) {
    var EX = 2.6, H0 = 170;                // vertical exaggeration, base level (m)
    var camX = 12000 + p * 17000, camY = 21500;
    // height: stay ~700 m (exaggerated) above the highest ground in the next 3 km
    var hi = 0;
    for (var a = 0; a <= 3000; a += 250) hi = Math.max(hi, elev(camX + a, camY));
    var camZ = (hi - H0) * EX + 700;
    var f = Math.max(w, h) * 0.55;          // focal length (px)
    var horizon = h * 0.12, near = 300, far = 16000, step = 200;
    var paper = color("--paper"), line = color("--contour");
    ctx.lineWidth = 1;
    ctx.lineJoin = "round";
    for (var X = Math.floor((camX + far) / step) * step; X > camX + near; X -= step) {
      var d = X - camX;
      var fog = 1 - (d - near) / (far - near);
      ctx.beginPath();
      var top = Infinity;
      for (var sx = -4; sx <= w + 4; sx += 4) {
        var Y = camY + ((sx - w / 2) / f) * d;
        var z = (elev(X, Y) - H0) * EX;
        var sy = horizon + (f * (camZ - z)) / d;
        if (sy < top) top = sy;
        if (sx < 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      if (top > h + 2) continue;
      ctx.lineTo(w + 4, h + 4);
      ctx.lineTo(-4, h + 4);
      ctx.closePath();
      ctx.globalAlpha = 1;
      ctx.fillStyle = paper;
      ctx.fill();
      ctx.globalAlpha = Math.max(0.18, Math.pow(fog, 1.5));
      ctx.strokeStyle = line;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // --------------------------------------------------------- parallax --
  function drawParallax() {
    var g = meta.grid, Hm = g.rows * g.cell_m[1];
    var E0 = 14000, W = g.cols * g.cell_m[0] - E0; // east part: Freiburg and the Black Forest
    var max = document.documentElement.scrollHeight - h;
    var speed = 0.25, travel = max * speed;
    var s = Math.max(w / W, (h + travel + 240) / Hm); // px per metre
    var x0 = (w - W * s) / 2 - E0 * s;
    W += E0;
    var offset = 60 - (reduce.matches ? 0.35 * max : window.scrollY) * speed;
    var rowPx = 15, step = rowPx / s;
    var ex = 200 / (1300 * s);              // tallest relief ~200 px
    var paper = color("--paper"), line = color("--contour");
    ctx.lineWidth = 1;
    ctx.lineJoin = "round";
    ctx.strokeStyle = line;
    ctx.fillStyle = paper;
    var first = Math.max(0, Math.floor((-offset - 20) / s / step) * step);
    var left = Math.max(x0 + E0 * s, -4), right = Math.min(x0 + W * s, w + 4);
    for (var Y = first; Y < Hm; Y += step) {
      var y0 = Y * s + offset;
      if (y0 - 240 > h) break;
      ctx.beginPath();
      for (var sx = left; sx <= right; sx += 3) {
        var z = (elev((sx - x0) / s, Y) - 170) * ex * s;
        if (sx === left) ctx.moveTo(sx, y0 - z);
        else ctx.lineTo(sx, y0 - z);
      }
      ctx.lineTo(right, y0 + 2);
      ctx.lineTo(left, y0 + 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  // ------------------------------------------------------------- path --
  // A survey pattern over the viewport, like a drone mapping flight: parallel
  // lanes joined by round turns. The planned route is dashed, the flown part
  // solid, and the drone (accent) sits at its head.
  function surveyPoints() {
    var lanes = 8, x1 = w * 0.07, x2 = w * 0.93, y1 = h * 0.12, y2 = h * 0.92;
    var gap = (y2 - y1) / (lanes - 1), r = gap / 2, pts = [];
    for (var i = 0; i < lanes; i++) {
      var y = y1 + i * gap, ltr = i % 2 === 0;
      pts.push([ltr ? x1 : x2, y], [ltr ? x2 : x1, y]);
      if (i < lanes - 1) {
        var cx = ltr ? x2 : x1, dir = ltr ? 1 : -1;
        for (var k = 1; k < 16; k++) {
          var t = -Math.PI / 2 + (Math.PI * k) / 16;
          pts.push([cx + dir * r * Math.cos(t), y + r + r * Math.sin(t)]);
        }
      }
    }
    return pts;
  }
  function drawPath(p) {
    var pts = surveyPoints(), cum = [0];
    for (var k = 1; k < pts.length; k++) {
      cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    }
    var line = color("--contour"), mark = color("--accent-mark");
    ctx.lineWidth = 1;
    ctx.lineJoin = "round";
    ctx.strokeStyle = line;
    ctx.globalAlpha = 0.3;
    ctx.setLineDash([2, 6]);
    ctx.beginPath();
    pts.forEach(function (q, j) { if (j) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
    ctx.stroke();
    ctx.setLineDash([]);
    // flown part
    var flown = p * cum[cum.length - 1], head = pts[0];
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var n = 1; n < pts.length && cum[n - 1] < flown; n++) {
      var t = Math.min(1, (flown - cum[n - 1]) / (cum[n] - cum[n - 1] || 1));
      head = [pts[n - 1][0] + (pts[n][0] - pts[n - 1][0]) * t, pts[n - 1][1] + (pts[n][1] - pts[n - 1][1]) * t];
      ctx.lineTo(head[0], head[1]);
    }
    ctx.stroke();
    // drone: small cross with a ring, in the accent (a "you are here" marker)
    ctx.globalAlpha = 1;
    ctx.strokeStyle = mark;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(head[0], head[1], 6, 0, Math.PI * 2);
    ctx.moveTo(head[0] - 10, head[1]);
    ctx.lineTo(head[0] + 10, head[1]);
    ctx.moveTo(head[0], head[1] - 10);
    ctx.lineTo(head[0], head[1] + 10);
    ctx.stroke();
  }

  // ------------------------------------------------------------- draw --
  function draw() {
    queued = false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var p = progress();
    if (mode === "flight" && dem) {
      drawFlight(p);
      canvas.style.setProperty("--fade", String(1 - 0.85 * orbitShare()));
    } else if (mode === "parallax" && dem) {
      drawParallax();
      canvas.style.removeProperty("--fade");
    } else if (mode === "path") {
      drawPath(p);
      canvas.style.removeProperty("--fade");
    }
  }
  function request() {
    if (!queued) {
      queued = true;
      requestAnimationFrame(draw);
    }
  }

  function setMode(next) {
    mode = next;
    try { localStorage.setItem("bg-preview", next); } catch (e) {}
    root.dataset.bg = next;
    picker.querySelectorAll("button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.bg === next));
    });
    if (next === "flight" || next === "parallax") loadDem().then(request);
    request();
  }

  // ----------------------------------------------------------- picker --
  var labels = de
    ? { title: "Hintergrund (Vorschau)", village: "Dorf", flight: "Flug", parallax: "Parallaxe", path: "Flugroute" }
    : { title: "Background (preview)", village: "village", flight: "flight", parallax: "parallax", path: "flight path" };
  var picker = document.createElement("div");
  picker.className = "bg-picker";
  picker.setAttribute("role", "group");
  picker.setAttribute("aria-label", labels.title);
  picker.innerHTML =
    "<span>" + labels.title + "</span>" +
    MODES.map(function (m) { return '<button type="button" data-bg="' + m + '">' + labels[m] + "</button>"; }).join("");
  picker.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (b) setMode(b.dataset.bg);
  });

  function start() {
    document.body.insertBefore(canvas, document.body.firstChild);
    document.body.appendChild(picker);
    resize();
    setMode(mode);
    window.addEventListener("resize", function () { resize(); request(); });
    window.addEventListener("scroll", function () { if (!reduce.matches) request(); }, { passive: true });
    new MutationObserver(request).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", request);
  }
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start);
})();
